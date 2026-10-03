"""Build bounded, lossless spatial and temporal patches for FFmpeg compositing."""

import logging
import os
import queue
import re
import subprocess
import threading
import time
from dataclasses import dataclass


from batch_context import _check_cancelled
from encode_args import _ANIMATED_IMAGE_EXTS
from delogo_chains import (
    _build_boxblur_filter,
    _build_padded_region,
    _delogo_reconstruction_filter,
)
from ffmpeg_runner import StderrBuffer
from op_shared import _coerce_int

logger = logging.getLogger("beru")
_PTS = re.compile(r"\bn:\s*\d+.*?pts_time:([-+\d.eE]+)")


@dataclass
class MotionPatch:
    path: str
    x: int
    y: int
    width: int
    height: int


def extra_media_input_args(path, *, duration=0, image_fps=None):
    if os.path.splitext(path)[1].lower() == ".mkv":
        return ["-i", path]
    args = ["-loop", "1"]
    if duration > 0:
        args += ["-t", f"{duration:.3f}"]
    if image_fps and os.path.splitext(path)[1].lower() not in _ANIMATED_IMAGE_EXTS:
        args += ["-framerate", str(image_fps)]
    return args + ["-i", path]


class TemporalPatchResolver:
    def __init__(
        self,
        input_path,
        directory,
        ffmpeg,
        fps,
        *,
        source_format=None,
        seek=0,
        frame_limit=None,
        ctx=None,
        timeout=7200,
    ):
        self.input_path = input_path
        self.directory = directory
        self.ffmpeg = ffmpeg
        self.fps = fps
        self.source_format = source_format
        self.seek = seek
        self.frame_limit = frame_limit
        self.ctx = ctx
        self.timeout = timeout

    def __call__(self, index, op, width, height, prefix, label, media):
        if not (0 < self.fps <= 240):
            return None
        region = op["region"]
        x, y, w, h = (region[k] for k in ("x", "y", "w", "h"))
        feather = _coerce_int(op.get("edge_feather"), 6, 0, 40)
        radius = _coerce_int(op.get("temporal_radius"), 3, 1, 15)
        spatial = (op.get("delogo_method") or "").lower() == "inpaint"
        if spatial:
            radius = 3
        effect = _build_padded_region(
            x, y, w, h, width, height, max(2, feather), aligned=True
        )
        if effect is None:
            return None
        ex, ey, ew, eh = effect
        bx, by, bw, bh = _build_padded_region(
            ex, ey, ew, eh, width, height, 96 if spatial else 32, aligned=True
        )
        if bw * bh > 1280 * 720:
            logger.info("Temporal: spatial fallback for a patch larger than 1280x720")
            return None
        box = (x - bx, y - by, w, h)
        spatial_format = (self.source_format or "yuv420p").replace("10le", "")
        if spatial_format not in (
            "yuv420p",
            "yuv422p",
            "yuv444p",
            "yuvj420p",
            "yuvj422p",
            "yuvj444p",
        ):
            spatial_format = "yuv420p"
        if box[0] > 0 and box[1] > 0 and box[0] + w < bw and box[1] + h < bh:
            fallback = f"format={spatial_format}," + _delogo_reconstruction_filter(
                *box, bw, bh, guard=0 if spatial else 2
            )
            if feather:
                fallback += "," + _build_boxblur_filter(2, 1)
        else:
            strength = _coerce_int(op.get("blur_strength"), 20, 1, 100)
            r = max(1, strength // 3)
            fallback = f"format={spatial_format}," + _build_boxblur_filter(
                r, max(1, r // 2), 3
            )
        graph = (
            (prefix + ";" if prefix else "")
            + f'{label or "[0:v]"}crop={bw}:{bh}:{bx}:{by},split[mt_original][mt_fallback];'
        )
        graph += f"[mt_original]format=rgb48le[mt_rgb];[mt_fallback]{fallback},format=rgb48le[mt_fill];"
        graph += "[mt_rgb][mt_fill]hstack,showinfo[mt_decode]"
        decoder = [self.ffmpeg, "-hide_banner", "-loglevel", "info", "-threads", "1"]
        if self.seek:
            decoder += ["-ss", f"{self.seek:.3f}"]
        decoder += ["-i", self.input_path]
        for path in media:
            decoder += extra_media_input_args(path)
        decoder += [
            "-filter_complex_threads",
            "1",
            "-filter_complex",
            graph,
            "-map",
            "[mt_decode]",
        ]
        if self.frame_limit:
            decoder += ["-frames:v", str(self.frame_limit)]
        decoder += [
            "-fps_mode",
            "passthrough",
            "-pix_fmt",
            "rgb48le",
            "-f",
            "rawvideo",
            "pipe:1",
        ]
        path = os.path.join(self.directory, f"temporal-{index}.mkv")
        encoder = [
            self.ffmpeg,
            "-v",
            "error",
            "-y",
            "-threads",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb48le",
            "-s",
            f"{ew}x{eh}",
            "-r",
            f"{self.fps:.8f}",
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "ffv1",
            "-level",
            "3",
            "-pix_fmt",
            "gbrp16le",
            "-threads",
            "1",
            path,
        ]
        ok = self._render(
            decoder,
            encoder,
            bw,
            bh,
            box,
            radius,
            (ex - bx, ey - by, ew, eh),
            spatial=spatial,
        )
        if not ok:
            if os.path.exists(path):
                os.unlink(path)
            return None
        return MotionPatch(path, ex, ey, ew, eh)

    def _render(
        self, decoder, encoder, width, height, box, radius, crop, *, spatial=False
    ):
        import numpy as np
        from temporal_motion import compensated_frames
        from spatial_inpaint import reconstruct_texture

        processes = []
        threads = []
        stop = threading.Event()
        timestamps = queue.Queue(maxsize=128)
        errors = StderrBuffer()
        variable = False
        count = 0
        timed_out = threading.Event()

        def read_errors(proc, capture_pts):
            for line in iter(proc.stderr.readline, b""):
                text = line.decode("utf-8", errors="replace")
                if capture_pts and (match := _PTS.search(text)):
                    while not stop.is_set():
                        try:
                            timestamps.put(float(match.group(1)), timeout=0.1)
                            break
                        except queue.Full:
                            pass
                else:
                    errors.append(text)

        def watch():
            deadline = time.monotonic() + self.timeout
            while not stop.wait(0.1):
                disk_bytes = sum(
                    item.stat().st_size
                    for item in os.scandir(self.directory)
                    if item.name.endswith(".mkv")
                )
                if (
                    _check_cancelled(self.ctx)
                    or time.monotonic() > deadline
                    or disk_bytes > 512 * 1024 * 1024
                ):
                    if not _check_cancelled(self.ctx):
                        timed_out.set()
                    for proc in processes:
                        if proc.poll() is None:
                            proc.kill()
                    return

        def frames():
            nonlocal variable, count
            previous = None
            size = width * 2 * height * 6
            while True:
                if _check_cancelled(self.ctx):
                    raise RuntimeError("Cancelled")
                data = processes[0].stdout.read(size)
                if not data:
                    return
                if len(data) != size:
                    raise RuntimeError("Incomplete temporal frame")
                timestamp = timestamps.get(timeout=10)
                if previous is not None and abs(
                    timestamp - previous - 1 / self.fps
                ) > max(0.003, 0.05 / self.fps):
                    variable = True
                    return
                previous = timestamp
                count += 1
                image = np.frombuffer(data, np.uint16).reshape(height, width * 2, 3)
                yield image[:, :width].copy(), image[:, width:].copy()

        try:
            env = dict(self.ctx.env) if self.ctx else None
            processes.append(
                subprocess.Popen(
                    decoder, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env
                )
            )
            processes.append(
                subprocess.Popen(
                    encoder, stdin=subprocess.PIPE, stderr=subprocess.PIPE, env=env
                )
            )
            for proc, capture in zip(processes, (True, False)):
                thread = threading.Thread(
                    target=read_errors, args=(proc, capture), daemon=True
                )
                thread.start()
                threads.append(thread)
            monitor = threading.Thread(target=watch, daemon=True)
            monitor.start()
            threads.append(monitor)
            cx, cy, cw, ch = crop
            donor_guard = 0 if "444" in (self.source_format or "") else 2
            if spatial:
                mx, my, mw, mh = _build_padded_region(
                    cx, cy, cw, ch, width, height, 32, aligned=True
                )

                def texture_frames():
                    for original, filled in frames():
                        repaired = reconstruct_texture(original, filled, box)
                        yield original[my : my + mh, mx : mx + mw].copy(), repaired[
                            my : my + mh, mx : mx + mw
                        ].copy(), repaired is not filled

                motion_box = (box[0] - mx, box[1] - my, box[2], box[3])
                output_frames = compensated_frames(
                    texture_frames(), motion_box, radius, guard=donor_guard
                )
                output_x, output_y = cx - mx, cy - my
            else:
                output_frames = compensated_frames(
                    frames(), box, radius, guard=donor_guard
                )
                output_x, output_y = cx, cy
            for image in output_frames:
                if variable:
                    break
                patch = image[output_y : output_y + ch, output_x : output_x + cw]
                processes[1].stdin.write(patch.tobytes())
            processes[1].stdin.close()
            if variable:
                logger.info("Temporal: variable frame timing; using spatial repair")
                return False
            for proc in processes:
                if proc.wait(timeout=30) != 0:
                    if _check_cancelled(self.ctx):
                        raise RuntimeError("Cancelled")
                    raise RuntimeError(
                        errors.join()[-2000:] or "Temporal FFmpeg failed"
                    )
            if not count:
                raise RuntimeError("Temporal source produced no frames")
            return True
        except Exception:
            if timed_out.is_set() and not _check_cancelled(self.ctx):
                logger.info(
                    "Temporal: preparation exceeded its time/disk budget; using spatial repair"
                )
                return False
            raise
        finally:
            stop.set()
            for proc in processes:
                if proc.poll() is None:
                    proc.kill()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
            for thread in threads:
                thread.join(timeout=1)
            for proc in processes:
                for stream in (proc.stdin, proc.stdout, proc.stderr):
                    if stream and not stream.closed:
                        stream.close()
