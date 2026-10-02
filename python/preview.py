"""Single-frame previews with injectable binary paths, probes and filter builders."""

import base64
import os
import subprocess
import threading

import media_probe
from filters import build_filter_complex
from media_paths import _validated_job_media
from op_shared import (
    _coerce_int,
    _normalize_operation,
    _optimize_delogo_for_speed,
)

PREVIEW_MAX_DIMENSION = 1280
PREVIEW_MAX_JPEG_BYTES = 3 * 1024 * 1024
PREVIEW_MAX_STDERR_BYTES = 64 * 1024
PREVIEW_MAX_REQUEST_BYTES = 1024 * 1024

_PREVIEW_FALLBACK_FPS = 25.0


def _preview_scale_filter():
    return (
        f"scale=w='min({PREVIEW_MAX_DIMENSION},iw)'"
        f":h='min({PREVIEW_MAX_DIMENSION},ih)'"
        ":force_original_aspect_ratio=decrease"
    )


def _preview_temporal_radius(operations):
    """Max tmedian radius still scheduled — temporal filters need that context."""
    radius = 0
    for op in operations or []:
        if not isinstance(op, dict):
            continue
        if (op.get("mode") or "").lower() != "delogo":
            continue
        if (op.get("delogo_method") or "").lower() != "temporal":
            continue
        radius = max(radius, _coerce_int(op.get("temporal_radius"), 3, 1, 15))
    return radius


def _preview_seek_seconds(timestamp, operations, frame_rate):
    """Seek point so `radius` lead-in frames still reach temporal filters."""
    radius = _preview_temporal_radius(operations)
    if radius <= 0:
        return timestamp
    fps = frame_rate if frame_rate and frame_rate > 0 else _PREVIEW_FALLBACK_FPS
    lead = (radius + 2) / fps
    return max(0.0, timestamp - lead)


def _shift_op_time_bounds(op, offset):
    """Rebase op start/end onto the seek-shifted timeline.

    `-ss S` makes filter `t` start at 0 for source time S, so each op's
    [start_time, end_time] window shifts by -S to keep enable=between(t,...)
    evaluating the same source-time semantics as an unseeked export.
    """
    if offset <= 0 or not isinstance(op, dict):
        return op
    start = op.get("start_time", op.get("startTime"))
    end = op.get("end_time", op.get("endTime"))
    if start is None and end is None:
        return op
    out = dict(op)
    for key in ("start_time", "startTime", "end_time", "endTime"):
        out.pop(key, None)
    for key, value in (("start_time", start), ("end_time", end)):
        if value is None:
            continue
        try:
            out[key] = float(value) - offset
        except (TypeError, ValueError):
            out[key] = value
    return out


def _run_preview_image_cmd(cmd, vw, vh, timestamp):
    """Run a single-frame mjpeg command with bounded pipes; return the payload dict."""
    proc = None
    output = {}

    def read_limited(stream, key, limit):
        try:
            output[key] = stream.read(limit + 1)
            if len(output[key]) > limit:
                try:
                    proc.kill()
                except OSError:
                    pass
        except OSError as exc:
            output[f"{key}_error"] = str(exc)

    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        readers = [
            threading.Thread(
                target=read_limited, args=(proc.stdout, "stdout", PREVIEW_MAX_JPEG_BYTES), daemon=True,
            ),
            threading.Thread(
                target=read_limited, args=(proc.stderr, "stderr", PREVIEW_MAX_STDERR_BYTES), daemon=True,
            ),
        ]
        for reader in readers:
            reader.start()
        try:
            code = proc.wait(timeout=45)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
            return {"ok": False, "error": "Timeout al renderizar el frame"}
        finally:
            for reader in readers:
                reader.join(timeout=2)
    except Exception as exc:
        if proc is not None and proc.poll() is None:
            proc.kill()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
        return {"ok": False, "error": str(exc)}
    finally:
        if proc is not None:
            proc.stdout.close()
            proc.stderr.close()

    if len(output.get("stdout", b"")) > PREVIEW_MAX_JPEG_BYTES:
        return {"ok": False, "error": "El frame de preview supera el límite de tamaño"}
    if len(output.get("stderr", b"")) > PREVIEW_MAX_STDERR_BYTES:
        return {"ok": False, "error": "La salida de FFmpeg supera el límite de tamaño"}
    if "stdout_error" in output or "stderr_error" in output:
        return {"ok": False, "error": "No se pudo leer la salida de FFmpeg"}
    if code != 0:
        err = output.get("stderr", b"").decode("utf-8", errors="replace").strip()
        return {"ok": False, "error": err or f"FFmpeg exited with code {code}"}

    buf = output.get("stdout", b"")
    if len(buf) < 64:
        return {"ok": False, "error": "FFmpeg no produjo imagen"}

    preview_ratio = min(1, PREVIEW_MAX_DIMENSION / max(vw, vh))
    output_w = round(vw * preview_ratio)
    output_h = round(vh * preview_ratio)
    for offset in range(2, len(buf) - 9):
        if buf[offset] == 0xFF and buf[offset + 1] in (0xC0, 0xC1, 0xC2):
            output_h = int.from_bytes(buf[offset + 5:offset + 7], "big")
            output_w = int.from_bytes(buf[offset + 7:offset + 9], "big")
            break

    data_url = "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")
    return {
        "ok": True,
        "data_url": data_url,
        "width": output_w,
        "height": output_h,
        "timestamp": timestamp,
    }


def _run_preview_with_end_fallback(make_command, info, input_path, vw, vh, timestamp, *,
                                   probe_fn=None):
    probe = probe_fn or media_probe.ffprobe
    result = _run_preview_image_cmd(make_command(timestamp), vw, vh, timestamp)
    if result.get("error") != "FFmpeg no produjo imagen" or timestamp <= 0:
        return result

    probed = probe(input_path)
    frame_rate = float(probed.get("frame_rate") or info.get("frame_rate") or 0)
    duration = float(probed.get("video_end") or info.get("duration") or probed.get("duration") or 0)
    if frame_rate <= 0 or duration <= 0:
        return result

    retry_from = min(duration, timestamp + 1 / frame_rate)
    attempted = {round(timestamp, 6)}

    for frames_back in (1, 2, 4, 8):
        sample_timestamp = max(0.0, retry_from - frames_back / frame_rate)
        rounded = round(sample_timestamp, 6)
        if rounded in attempted:
            continue
        attempted.add(rounded)
        result = _run_preview_image_cmd(
            make_command(sample_timestamp), vw, vh, timestamp
        )
        if result.get("error") != "FFmpeg no produjo imagen" or sample_timestamp == 0:
            return result

    return result


def render_frame(payload, *, source_only, ffmpeg_path=None, probe_fn=None,
                 info_fn=None, filter_fn=None):
    """Render one frame: filtered preview or raw source decode.

    Returns a dict: {ok, data_url?, error?, width?, height?, timestamp?}
    """
    ffmpeg_path = ffmpeg_path or media_probe.FFMPEG
    probe_fn = probe_fn or media_probe.ffprobe
    info_fn = info_fn or media_probe.job_video_info
    filter_fn = filter_fn or build_filter_complex
    try:
        payload = _validated_job_media(payload, require_output=False)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    input_path = payload.get("input_path")
    if not input_path or not os.path.exists(input_path):
        return {"ok": False, "error": f"Input not found: {input_path}"}

    try:
        timestamp = max(0.0, float(payload.get("timestamp", 0)))
    except (TypeError, ValueError):
        timestamp = 0.0

    info = info_fn(payload, input_path)
    vw = int(payload.get("source_width") or payload.get("width") or info.get("width") or 0)
    vh = int(payload.get("source_height") or payload.get("height") or info.get("height") or 0)
    if vw <= 0 or vh <= 0:
        return {"ok": False, "error": "No se pudo leer la resolución del video"}

    if source_only:
        def make_source_command(sample_timestamp):
            return [
                ffmpeg_path, "-hide_banner", "-loglevel", "error", "-y",
                "-ss", f"{sample_timestamp:.3f}",
                "-i", input_path,
                "-map", "0:v:0",
                "-vf", _preview_scale_filter(),
                "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
            ]

        return _run_preview_with_end_fallback(
            make_source_command, info, input_path, vw, vh, timestamp,
            probe_fn=probe_fn,
        )

    raw_operations = payload.get("operations") or []
    operations = [
        _optimize_delogo_for_speed(_normalize_operation(op), vw, vh)
        for op in raw_operations
    ]
    watermark = payload.get("watermark")

    frame_rate = float(info.get("frame_rate") or 0)

    def make_command(sample_timestamp):
        seek = _preview_seek_seconds(sample_timestamp, operations, frame_rate)
        target_rel = sample_timestamp - seek
        graph_ops = [_shift_op_time_bounds(op, seek) for op in operations]
        filter_complex, output_label, image_paths = filter_fn(
            graph_ops, vw, vh, watermark=watermark,
        )

        cmd = [
            ffmpeg_path, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{seek:.3f}",
            "-i", input_path,
        ]
        for img_path in image_paths:
            cmd += ["-loop", "1", "-i", img_path]
        preview_scale = _preview_scale_filter()
        pick_target = f"select='gte(t\\,{target_rel:.6f})'"
        if filter_complex:
            cmd += [
                "-filter_complex",
                f"{filter_complex};{output_label}{pick_target},{preview_scale}[preview]",
                "-map", "[preview]",
            ]
        else:
            cmd += ["-map", "0:v:0", "-vf", f"{pick_target},{preview_scale}"]
        cmd += ["-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"]
        return cmd

    return _run_preview_with_end_fallback(
        make_command, info, input_path, vw, vh, timestamp, probe_fn=probe_fn,
    )


def render_preview_frame(payload, **kwargs):
    """Render one video frame with export-equivalent filters."""
    return render_frame(payload, source_only=False, **kwargs)


def render_source_frame(payload, **kwargs):
    """Decode one frame straight from a rendered artifact (no filter graph)."""
    return render_frame(payload, source_only=True, **kwargs)
