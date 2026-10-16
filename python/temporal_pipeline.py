import logging
import math
import os
import queue
import re
import subprocess
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass


from batch_context import _check_cancelled
from encode_args import _ANIMATED_IMAGE_EXTS
from delogo_chains import (
    _build_boxblur_filter,
    _build_padded_region,
    _delogo_reconstruction_filter,
)
from ffmpeg_runner import StderrBuffer, _emit_job_progress, _emit_warning, _kill_ffmpeg_process
from op_shared import _coerce_int

logger = logging.getLogger("beru")
_PTS = re.compile(r"\bn:\s*\d+.*?pts_time:([-+\d.eE]+)")
_MAX_ATLAS_PIXELS = 1920 * 1080 * 4
_PATCH_SKIP_MESSAGES = {
    "patch_skipped_timing": (
        "Reconstrucci\u00f3n temporal omitida: el video tiene timestamps irregulares; "
        "se aplic\u00f3 reparaci\u00f3n espacial."
    ),
    "patch_skipped_budget": (
        "Reconstrucci\u00f3n temporal omitida: excedi\u00f3 el presupuesto de tiempo; "
        "se aplic\u00f3 reparaci\u00f3n espacial."
    ),
    "patch_skipped_too_large": (
        "Reconstrucci\u00f3n temporal omitida: el \u00e1rea a reconstruir es demasiado grande; "
        "se aplic\u00f3 reparaci\u00f3n espacial."
    ),
}


@dataclass
class MotionPatch:
    path: str
    x: int
    y: int
    width: int
    height: int
    start: float = 0
    # (patch frame index, seconds) jumps of a variable-rate source.
    steps: tuple = ()


@dataclass
class _PreparedPatch:
    patch: MotionPatch
    context: tuple
    box: tuple
    radius: int
    spatial: bool
    window: tuple
    fallback: str

    @property
    def crop(self):
        bx, by, _, _ = self.context
        patch = self.patch
        return patch.x - bx, patch.y - by, patch.width, patch.height


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
        job_id=None,
        progress_range=None,
        total_frames=None,
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
        self.job_id = job_id
        self.progress_range = progress_range if progress_range is not None else (0, 100)
        self.total_frames = total_frames
        self._patch_total = None
        self._frames_seen = 0
        self._defer_reason = None

    def _report_patch_frames(self, count):
        self._frames_seen = max(self._frames_seen, count)
        if self.job_id is None or self.ctx is None:
            return
        lo, hi = self.progress_range
        total = self._patch_total
        percent = lo + (hi - lo) * min(count, total) / total if total else lo
        _emit_job_progress(self.job_id, percent, None, ctx=self.ctx, fields={"phase": "patch"})

    def _estimate_patch_frames(self, start, end, frame_limit):
        if self.total_frames is None or not (0 < self.fps <= 240):
            return None
        total = self.total_frames
        if end is not None:
            total = min(total, math.ceil(end * self.fps))
        if start > 0:
            total = max(1, total - math.floor(start * self.fps + 1e-6))
        if frame_limit is not None:
            total = min(total, frame_limit)
        return total or None

    def _warn_patch_skipped(self):
        if self.job_id is None:
            return
        code = self._defer_reason
        if code:
            _emit_warning(self.job_id, code, _PATCH_SKIP_MESSAGES.get(code, code))

    def _prepare_patch(self, index, op, width, height):
        self._frames_seen = 0
        self._defer_reason = None
        if not (0 < self.fps <= 240):
            return None
        region = op["region"]
        x, y, w, h = (region[k] for k in ("x", "y", "w", "h"))
        feather = _coerce_int(op.get("edge_feather"), 6, 0, 40)
        radius = _coerce_int(op.get("temporal_radius"), 3, 1, 15)
        spatial = (op.get("delogo_method") or "").lower() == "inpaint"
        if spatial:
            radius = 3
        bounds = {}
        for snake, camel in (("start_time", "startTime"), ("end_time", "endTime")):
            try:
                value = float(op.get(snake, op.get(camel)))
            except (TypeError, ValueError):
                continue
            if math.isfinite(value):
                bounds[snake] = value
        start = max(0, math.floor(bounds.get("start_time", 0) * self.fps + 1e-6) - radius) / self.fps
        end = None
        if "end_time" in bounds:
            end = (math.ceil(bounds["end_time"] * self.fps - 1e-6) + radius + 1) / self.fps
            if end <= start:
                return None
        frame_limit = self.frame_limit
        if frame_limit is not None:
            frame_limit -= math.floor(start * self.fps + 1e-6)
            if frame_limit <= 0:
                return None
        self._patch_total = self._estimate_patch_frames(start, end, frame_limit)
        effect = _build_padded_region(
            x, y, w, h, width, height, max(2, feather), aligned=True
        )
        if effect is None:
            return None
        ex, ey, ew, eh = effect
        bx, by, bw, bh = _build_padded_region(
            ex, ey, ew, eh, width, height, 96 + min(w, h) // 2 if spatial else 32, aligned=True
        )
        if bw * bh > 1280 * 720:
            self._defer_reason = "patch_skipped_too_large"
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
        return _PreparedPatch(
            MotionPatch(os.path.join(self.directory, f"temporal-{index}.mkv"), ex, ey, ew, eh),
            (bx, by, bw, bh), box, radius, spatial, (start, end, frame_limit), fallback,
        )

    def __call__(self, index, op, width, height, prefix, label, media):
        prepared = self._prepare_patch(index, op, width, height)
        if prepared is None:
            return None
        bx, by, bw, bh = prepared.context
        start, end, frame_limit = prepared.window
        trim = ""
        if start > 0 or end is not None:
            trim = f"trim=start={start:.8f}"
            if end is not None:
                trim += f":end={end:.8f}"
            trim += ","
        graph = (
            (prefix + ";" if prefix else "")
            + f'{label or "[0:v]"}{trim}crop={bw}:{bh}:{bx}:{by},split[mt_original][mt_fallback];'
        )
        graph += f"[mt_original]format=rgb48le[mt_rgb];[mt_fallback]{prepared.fallback},format=rgb48le[mt_fill];"
        graph += "[mt_rgb][mt_fill]hstack,showinfo[mt_decode]"
        timing = self._render(
            self._decoder(graph, frame_limit, media),
            [prepared],
        )
        if timing is None:
            if os.path.exists(prepared.patch.path):
                os.unlink(prepared.patch.path)
            if self._defer_reason and not _check_cancelled(self.ctx):
                self._warn_patch_skipped()
            return None
        prepared.patch.start, prepared.patch.steps = timing
        return prepared.patch

    def resolve_batch(self, indexes, ops, width, height, prefix, label, media):
        """Return None for serial preparation when patches depend on earlier output."""
        if len(ops) < 2 or self.seek or self.source_format not in {
            "yuv420p", "yuv422p", "yuv444p",
            "yuv420p10le", "yuv422p10le", "yuv444p10le",
        }:
            return None
        prepared = [self._prepare_patch(index, op, width, height)
                    for index, op in zip(indexes, ops)]
        if any(item is None for item in prepared):
            return None
        window = prepared[0].window
        if any(item.window != window for item in prepared):
            return None
        for i, item in enumerate(prepared):
            x, y, w, h = item.context
            for previous in prepared[:i]:
                patch = previous.patch
                if (x < patch.x + patch.width and patch.x < x + w
                        and y < patch.y + patch.height and patch.y < y + h):
                    return None
        atlas_height = max(item.context[3] for item in prepared)
        atlas_width = sum(2 * item.context[2] for item in prepared)
        if atlas_width * atlas_height > _MAX_ATLAS_PIXELS:
            return None
        start, end, frame_limit = window
        trim = ""
        if start > 0 or end is not None:
            trim = f"trim=start={start:.8f}"
            if end is not None:
                trim += f":end={end:.8f}"
            trim += ","
        labels = "".join(f"[mt_source{i}]" for i in range(len(prepared)))
        graph = (prefix + ";" if prefix else "") + (
            f'{label or "[0:v]"}{trim}split={len(prepared)}{labels};'
        )
        atlas = []
        for i, item in enumerate(prepared):
            x, y, w, h = item.context
            graph += (f"[mt_source{i}]crop={w}:{h}:{x}:{y},split[mt_original{i}][mt_fallback{i}];"
                      f"[mt_original{i}]format=rgb48le,pad={w}:{atlas_height}[mt_rgb{i}];"
                      f"[mt_fallback{i}]{item.fallback},format=rgb48le,"
                      f"pad={w}:{atlas_height}[mt_fill{i}];")
            atlas += [f"[mt_rgb{i}]", f"[mt_fill{i}]"]
        graph += "".join(atlas) + f"hstack=inputs={len(atlas)},showinfo[mt_decode]"
        self._frames_seen = 0
        self._defer_reason = None
        self._patch_total = self._estimate_patch_frames(*window)
        try:
            timing = self._render(self._decoder(graph, frame_limit, media), prepared)
        except Exception:
            for item in prepared:
                if os.path.exists(item.patch.path):
                    os.unlink(item.patch.path)
            raise
        patches = {}
        for index, item in zip(indexes, prepared):
            if timing is None:
                if os.path.exists(item.patch.path):
                    os.unlink(item.patch.path)
                if self._defer_reason and not _check_cancelled(self.ctx):
                    self._warn_patch_skipped()
                patches[index] = None
            else:
                item.patch.start, item.patch.steps = timing
                patches[index] = item.patch
        return patches

    def _decoder(self, graph, frame_limit, media):
        decoder = [self.ffmpeg, "-nostdin", "-xerror", "-hide_banner", "-loglevel", "info", "-threads", "1"]
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
        if frame_limit:
            decoder += ["-frames:v", str(frame_limit)]
        decoder += [
            "-fps_mode",
            "passthrough",
            "-pix_fmt",
            "rgb48le",
            "-f",
            "rawvideo",
            "pipe:1",
        ]
        return decoder

    def _encoder(self, patch):
        return [
            self.ffmpeg,
            "-nostdin",
            "-xerror",
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
            f"{patch.width}x{patch.height}",
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
            patch.path,
        ]

    def _render(self, decoder, prepared):
        import numpy as np
        from temporal_motion import compensated_frames
        from spatial_inpaint import EXACT_SCORE, reconstruct_texture

        processes = []
        threads = []
        stop = threading.Event()
        timestamps = queue.Queue(maxsize=128)
        errors = StderrBuffer()
        error_lock = threading.Lock()
        background_error = []
        variable = False
        count = 0
        first_timestamp = None
        steps = []
        jitter = False
        tolerance = 0.1 / self.fps
        timed_out = threading.Event()
        width = sum(2 * item.context[2] for item in prepared)
        height = max(item.context[3] for item in prepared)
        inputs = [queue.Queue(maxsize=2) for _ in prepared]

        def stop_processes():
            for proc in processes:
                _kill_ffmpeg_process(proc)

        def fail_background(exc):
            with error_lock:
                background_error.append(str(exc))
            stop.set()
            stop_processes()

        def read_errors(proc, capture_pts):
            try:
                for line in iter(lambda: proc.stderr.readline(4096), b""):
                    text = line.decode("utf-8", errors="replace")
                    if capture_pts and (match := _PTS.search(text)):
                        while not stop.is_set():
                            try:
                                timestamps.put(float(match.group(1)), timeout=0.1)
                                break
                            except queue.Full:
                                pass
                    else:
                        with error_lock:
                            errors.append(text)
            except Exception as exc:
                fail_background(exc)

        def watch():
            deadline = time.monotonic() + self.timeout
            next_beat = time.monotonic() + 15
            try:
                while not stop.wait(0.1):
                    with os.scandir(self.directory) as entries:
                        disk_bytes = sum(item.stat().st_size for item in entries if item.name.endswith(".mkv"))
                    if self._frames_seen and time.monotonic() >= next_beat:
                        next_beat = time.monotonic() + 15
                        self._report_patch_frames(self._frames_seen)
                    if (
                        _check_cancelled(self.ctx)
                        or time.monotonic() > deadline
                        or disk_bytes > 512 * 1024 * 1024
                    ):
                        if not _check_cancelled(self.ctx):
                            timed_out.set()
                        stop.set()
                        stop_processes()
                        return
            except Exception as exc:
                fail_background(exc)

        def frames():
            nonlocal variable, count, first_timestamp, jitter
            previous = None
            offset = 0.0
            size = width * height * 6
            while True:
                if _check_cancelled(self.ctx):
                    raise RuntimeError("Cancelled")
                data = processes[0].stdout.read(size)
                if not data:
                    return
                if len(data) != size:
                    raise RuntimeError("Incomplete temporal frame")
                timestamp = timestamps.get(timeout=10)
                if first_timestamp is None:
                    first_timestamp = timestamp
                # Patch frames are written at a constant rate; record where a
                # variable-rate source drifts so the overlay can follow it.
                drift = timestamp - first_timestamp - count / self.fps
                if abs(drift - offset) > tolerance:
                    steps.append((count, drift - offset))
                    offset = drift
                jitter = jitter or abs(drift - offset) > 0.001
                if len(steps) > 64 or (
                    previous is not None and timestamp - previous <= 3 * tolerance
                ):
                    variable = True
                    return
                previous = timestamp
                count += 1
                self._report_patch_frames(count)
                yield np.frombuffer(data, np.uint16).reshape(height, width, 3)

        def put(inbox, value):
            while not stop.is_set():
                try:
                    inbox.put(value, timeout=0.1)
                    return
                except queue.Full:
                    pass

        def encode_patch(item, inbox, proc):
            def patch_frames():
                while not stop.is_set():
                    try:
                        value = inbox.get(timeout=0.1)
                    except queue.Empty:
                        continue
                    if value is None:
                        return
                    yield value

            try:
                _, _, pw, ph = item.context
                box, radius = item.box, item.radius
                cx, cy, cw, ch = item.crop
                donor_guard = 0 if "444" in (self.source_format or "") else 2
                if item.spatial:
                    mx, my, mw, mh = _build_padded_region(
                        cx, cy, cw, ch, pw, ph, 32, aligned=True
                    )

                    def texture_frame(original, filled, job):
                        repaired, score = job.result()
                        exact = repaired is not None and score <= EXACT_SCORE
                        return original[my : my + mh, mx : mx + mw].copy(), (
                            filled if repaired is None else repaired
                        )[my : my + mh, mx : mx + mw].copy(), exact

                    def texture_frames():
                        workers = min(4, os.cpu_count() or 1)
                        pending = deque()
                        with ThreadPoolExecutor(workers) as pool:
                            for original, filled in patch_frames():
                                job = pool.submit(
                                    reconstruct_texture, original, box, guard=donor_guard
                                )
                                pending.append((original, filled, job))
                                if len(pending) > 2 * workers:
                                    yield texture_frame(*pending.popleft())
                            while pending:
                                yield texture_frame(*pending.popleft())

                    motion_box = (box[0] - mx, box[1] - my, box[2], box[3])
                    output_frames = compensated_frames(
                        texture_frames(), motion_box, radius, guard=donor_guard
                    )
                    output_x, output_y = cx - mx, cy - my
                else:
                    output_frames = compensated_frames(
                        patch_frames(), box, radius, guard=donor_guard
                    )
                    output_x, output_y = cx, cy
                for image in output_frames:
                    if stop.is_set():
                        return
                    patch = image[output_y : output_y + ch, output_x : output_x + cw]
                    proc.stdin.write(patch.tobytes())
                proc.stdin.close()
            except Exception as exc:
                if not stop.is_set():
                    fail_background(exc)

        try:
            env = dict(self.ctx.env) if self.ctx else None
            processes.append(
                subprocess.Popen(
                    decoder, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                    stdin=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
            )
            for item in prepared:
                processes.append(subprocess.Popen(
                    self._encoder(item.patch), stdin=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                ))
            for i, proc in enumerate(processes):
                thread = threading.Thread(
                    target=read_errors, args=(proc, i == 0), daemon=True
                )
                thread.start()
                threads.append(thread)
            monitor = threading.Thread(target=watch, daemon=True)
            monitor.start()
            threads.append(monitor)
            self._report_patch_frames(0)
            workers = []
            for item, inbox, proc in zip(prepared, inputs, processes[1:]):
                thread = threading.Thread(target=encode_patch, args=(item, inbox, proc), daemon=True)
                thread.start()
                workers.append(thread)
                threads.append(thread)
            for image in frames():
                if stop.is_set():
                    break
                offset = 0
                for item, inbox in zip(prepared, inputs):
                    _, _, pw, ph = item.context
                    put(inbox, (image[:ph, offset:offset + pw].copy(),
                                image[:ph, offset + pw:offset + 2 * pw].copy()))
                    offset += 2 * pw
            if variable:
                self._defer_reason = "patch_skipped_timing"
                logger.info("Temporal: variable frame timing; using spatial repair")
                return None
            for inbox in inputs:
                put(inbox, None)
            for thread in workers:
                while thread.is_alive() and not stop.is_set():
                    thread.join(timeout=0.1)
            if _check_cancelled(self.ctx):
                raise RuntimeError("Cancelled")
            if timed_out.is_set():
                raise RuntimeError("Temporal preparation exceeded its budget")
            for proc in processes:
                code = proc.wait(timeout=30)
                if code != 0:
                    if _check_cancelled(self.ctx):
                        raise RuntimeError("Cancelled")
                    with error_lock:
                        detail = background_error[0] if background_error else errors.join()[-2000:]
                    raise RuntimeError(f"Temporal FFmpeg exited with code {code}: {detail}")
            if background_error:
                raise RuntimeError(background_error[0])
            if not count:
                raise RuntimeError("Temporal source produced no frames")
            # Lead each frame slightly so rounding never shows its predecessor.
            margin = 2 * tolerance if steps or jitter else 0
            return first_timestamp - margin, tuple(steps)
        except Exception as exc:
            if background_error:
                raise RuntimeError(background_error[0]) from exc
            if timed_out.is_set() and not _check_cancelled(self.ctx):
                self._defer_reason = "patch_skipped_budget"
                logger.info(
                    "Temporal: preparation exceeded its time/disk budget; using spatial repair"
                )
                return None
            raise
        finally:
            stop.set()
            stop_processes()
            for thread in threads:
                thread.join(timeout=1)
            for proc in processes:
                for stream in (proc.stdin, proc.stdout, proc.stderr):
                    if stream and not stream.closed:
                        try:
                            stream.close()
                        except OSError:
                            # Killed encoders can still have buffered input to flush.
                            if stream is not proc.stdin:
                                raise
