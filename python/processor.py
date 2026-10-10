#!/usr/bin/env python3
"""Batch scheduling, per-job execution and CLI/NDJSON worker entrypoints.

Consumes JSON job manifests and emits progress as NDJSON on stdout.
Imported helpers remain re-exported for compatibility; wrappers forward
processor state and patched dependencies to the helper modules.
"""

import os
import subprocess
import sys

if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "--run-media":
    try:
        if sys.platform != "win32":
            raise RuntimeError("Beru solo admite Windows.")
        from process_lifetime import protect_process_tree
        protect_process_tree()
        code = subprocess.call(
            sys.argv[2:], stdin=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception as exc:
        print(f"No se pudo iniciar el proceso de medios: {exc}", file=sys.stderr, flush=True)
        code = 1
    sys.exit(code)

import concurrent.futures
import json
import logging
import logging.handlers
import math
import shutil
import tempfile
import threading
from collections import deque
from dataclasses import replace
from pathlib import Path

import filters
import fonts
import media_probe
import preview
from process_lifetime import protect_process_tree
from temporal_pipeline import TemporalPatchResolver, extra_media_input_args

from encode_profiles import (
    ENCODE_PROFILES,
    effective_hw_encoder as resolve_effective_hw_encoder,
    profile_allows_hardware,
)
from batch_errors import (
    format_processing_error,
    is_hardware_encode_error,
    is_resource_pressure_error,
    remove_partial_output,
)

from op_shared import (
    _build_enable_clause,
    _is_op_time_disabled,
    _normalize_operation,
    _region_to_pixels,
)
from media_paths import (
    FONT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    VIDEO_INPUT_EXTENSIONS,
    VIDEO_OUTPUT_EXTENSIONS,
    _path_parent,
    _validated_job_media,
    validate_media_path,
)
from job_classify import (
    _job_dimensions,
    _job_requires_encode,
    _job_takes_copy_path,
    _jobs_allow_hardware,
    _jobs_require_fonts,
    _parse_trim_window,
)
from capacity import (
    MAX_WORKERS_CAP,
    _ENCODER_CAPS,
    _REMUX_JOB_RAM_MB,
    _estimate_job_ram_mb,
    _get_available_ram_mb,
    _max_estimated_job_ram_mb,
    _memory_cap_workers,
    resolve_copy_workers,
    resolve_max_workers,
)
from batch_context import BatchContext, _ResourceAdmission, _cancel_event, _check_cancelled
from encoders import _test_hw_encoder_real, detect_hw_encoder
from encode_args import (
    _ANIMATED_IMAGE_EXTS,
    _AUDIO_COPY_CODECS,
    _COPY_SAFE_STREAM_TYPES,
    _FASTSTART_EXTS,
    build_audio_args,
)
from media_probe import find_ffmpeg, find_ffprobe
from fonts import (
    FONT_DIRS,
    _font_name_key,
    _get_normalized_fonts,
    _resolve_font,
    get_system_fonts,
    reset_caches,
)
from filters import (
    _DRAWTEXT_CACHE,
    _drawtext_cache_enabled,
    _drawtext_cache_store,
    _drawtext_supports,
    _escape_drawtext_text,
    _get_drawtext_options,
    _validate_drawtext_text,
)
from ffmpeg_runner import (
    StderrBuffer,
    _cleanup_ffmpeg_partial,
    _emit_batch_progress,
    _emit_job_complete,
    _emit_job_failed,
    _emit_job_progress,
    _extract_error_line,
    _input_path_from_ffmpeg_cmd,
    _is_transient_error,
    _job_cancelled_result,
    _job_failed_result,
    _kill_ffmpeg_process,
    _last_job_progress_emit,
    _native_stream_copy,
    _output_path_from_ffmpeg_cmd,
    _retry_failed_enabled,
    _run_ffmpeg,
    _run_ffmpeg_stream,
    _safe_print,
    _should_retry_failed_job,
    _should_retry_ffmpeg,
    MAX_RETRIES,
    RETRY_DELAYS,
)

FFMPEG = media_probe.FFMPEG
FFPROBE = media_probe.FFPROBE
JOB_MANIFEST_TYPE = "beru-job-manifest"
JOB_MANIFEST_VERSION = 1
PREVIEW_MAX_DIMENSION = preview.PREVIEW_MAX_DIMENSION
PREVIEW_MAX_IMAGE_BYTES = preview.PREVIEW_MAX_IMAGE_BYTES
PREVIEW_MAX_STDERR_BYTES = preview.PREVIEW_MAX_STDERR_BYTES
PREVIEW_MAX_REQUEST_BYTES = preview.PREVIEW_MAX_REQUEST_BYTES
JOB_WORKER_MAX_REQUEST_BYTES = 64 * 1024


def setup_logging():
    """Configure structured logging to rotating file and stderr."""
    logger = logging.getLogger("beru")
    logger.setLevel(logging.DEBUG)

    if not any(getattr(handler, "_beru_stderr", False) for handler in logger.handlers):
        sh = logging.StreamHandler(sys.stderr)
        sh._beru_stderr = True
        sh.setLevel(logging.INFO)
        sh.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
        logger.addHandler(sh)

    try:
        log_dir = Path(os.environ.get("BERU_LOG_DIR", Path.home() / ".beru" / "logs"))
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "processor.log"
        already_has_file_handler = any(
            isinstance(handler, logging.handlers.RotatingFileHandler)
            and Path(handler.baseFilename) == log_path
            for handler in logger.handlers
        )
        if not already_has_file_handler:
            fh = logging.handlers.RotatingFileHandler(
                log_path, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
            )
            fh.setLevel(logging.DEBUG)
            fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
            logger.addHandler(fh)
    except OSError as exc:
        logger.warning("File logging disabled: %s", exc)

    return logger


logger = setup_logging()

_BATCH_ACTIVE_WORKERS = 1
_SOFTWARE_FALLBACK_ADMISSION = None


def _sync_probe_binaries():
    """Propagate this module's (possibly patched) seams into the extracted
    modules: binary paths, the font catalogue provider, and the drawtext
    cache scalars the test suite mutates on ``processor``."""
    media_probe.FFMPEG = FFMPEG
    media_probe.FFPROBE = FFPROBE
    fonts.get_system_fonts = get_system_fonts
    mod_globals = globals()
    if "_DRAWTEXT_OPTIONS_CACHE" in mod_globals:
        filters._DRAWTEXT_OPTIONS_CACHE = mod_globals["_DRAWTEXT_OPTIONS_CACHE"]
        filters._DRAWTEXT_OPTIONS_CACHE_FOR = mod_globals.get("_DRAWTEXT_OPTIONS_CACHE_FOR")
    if "_DRAWTEXT_CACHE_ENABLED" in mod_globals:
        filters._DRAWTEXT_CACHE_ENABLED = mod_globals["_DRAWTEXT_CACHE_ENABLED"]


def ffprobe(path):
    """Probe wrapper: resolves this module's patchable FFMPEG/FFPROBE."""
    return media_probe.ffprobe(path, ffprobe_bin=FFPROBE, ffmpeg_bin=FFMPEG)


def _ffprobe_via_ffmpeg(path):
    return media_probe._ffprobe_via_ffmpeg(path, ffmpeg_bin=FFMPEG)


def _probe_stream_types(path):
    """[(codec_type, codec_name)] for each stream; None when ffprobe fails."""
    return media_probe._probe_stream_types(path, ffprobe_bin=FFPROBE)


def _native_copy_eligible(input_path, output_path, *, ctx=None):
    """Eligibility wrapper so a stubbed ``_probe_stream_types`` still applies."""
    probe = _probe_stream_types if ctx is None else lambda path: media_probe._probe_stream_types(
        path, ffprobe_bin=ctx.ffprobe_path
    )
    return media_probe._native_copy_eligible(input_path, output_path, probe_fn=probe)


def job_video_info(job, input_path, *, ctx=None):
    """Job-metadata-first probe; ``processor.ffprobe`` patches still apply."""
    probe = ffprobe if ctx is None else lambda path: media_probe.ffprobe(
        path, ffprobe_bin=ctx.ffprobe_path, ffmpeg_bin=ctx.ffmpeg_path
    )
    return media_probe.job_video_info(job, input_path, probe_fn=probe)


def _init_ffmpeg_globals():
    """Configure module-level FFMPEG/FFPROBE paths. Returns False if ffmpeg is missing."""
    global FFMPEG, FFPROBE

    ffmpeg_bin = find_ffmpeg()
    ffprobe_bin = find_ffprobe(ffmpeg_bin)
    if not (os.path.isfile(ffmpeg_bin) or shutil.which(ffmpeg_bin)):
        logger.error("ffmpeg not found at %s", ffmpeg_bin)
        return False

    FFMPEG = media_probe.FFMPEG = ffmpeg_bin
    FFPROBE = media_probe.FFPROBE = ffprobe_bin
    logger.info("Using ffmpeg: %s", FFMPEG)
    logger.info("Using ffprobe: %s", FFPROBE)
    return True


def build_drawtext(op):
    """Compatibility wrapper: keeps filters' ffmpeg probe on the current binary."""
    _sync_probe_binaries()
    return filters.build_drawtext(op)


def _build_watermark_filter(watermark, video_w, video_h):
    _sync_probe_binaries()
    return filters._build_watermark_filter(watermark, video_w, video_h)


def build_filter_complex(operations, video_w, video_h, watermark=None, _ffmpeg_path=None,
                         source_pix_fmt=None, temporal_resolver=None):
    """Compatibility wrapper: keeps filters' ffmpeg probe on the active binary."""
    if _ffmpeg_path is None:
        _sync_probe_binaries()
    return filters.build_filter_complex(
        operations, video_w, video_h, watermark=watermark, ffmpeg_path=_ffmpeg_path,
        source_pix_fmt=source_pix_fmt, temporal_resolver=temporal_resolver,
    )


def build_filter_thread_args(active_workers=None):
    """Parallelize filter graph; fewer threads per job when many jobs run at once."""
    workers = active_workers if active_workers is not None else _BATCH_ACTIVE_WORKERS
    cpus = os.cpu_count() or 4
    n = max(1, min(4, cpus // max(1, int(workers))))
    return ["-filter_threads", str(n), "-filter_complex_threads", str(n)]


def resolve_x264_threads(active_workers=None):
    """Bound libx264 threads per job so CPU fallback batches do not exhaust RAM."""
    workers = active_workers if active_workers is not None else _BATCH_ACTIVE_WORKERS
    cpus = os.cpu_count() or 4
    return max(1, min(8, cpus // max(1, int(workers))))


def build_encode_args(ffmpeg_path, profile_name, job, force_software=False,
                      hw_encoder=None, active_workers=None):
    """Return ffmpeg video encode argument list for the given profile.

    If hw_encoder is provided (from batch pre-flight), it is used directly
    without re-detecting.  This avoids re-probing and allows the batch-level
    pre-flight test to skip a broken GPU path entirely.
    """
    profile_key = (profile_name or "balanced").strip().lower()
    profile = ENCODE_PROFILES.get(profile_key, ENCODE_PROFILES["balanced"])
    use_hw = not force_software and profile_allows_hardware(profile_name)
    if hw_encoder is not None and use_hw:
        hw = hw_encoder
    elif use_hw:
        hw = detect_hw_encoder(ffmpeg_path)
    else:
        hw = None

    if hw == "h264_nvenc":
        cq = profile.get("hw_cq", 23)
        nv_preset = profile.get("nvenc_preset") or "p4"
        return ["-c:v", "h264_nvenc", "-preset", nv_preset, "-rc", "vbr", "-cq", str(cq)]

    if hw == "h264_qsv":
        gq = profile.get("hw_cq", 23)
        return ["-c:v", "h264_qsv", "-global_quality", str(gq)]

    if hw == "h264_mf":
        # MediaFoundation on Windows: rate control is quality scale.
        gq = profile.get("hw_cq", 23)
        return ["-c:v", "h264_mf", "-rate_control", "quality", "-quality", str(gq)]

    if hw == "h264_amf":
        quality = (
            "speed" if profile_key == "fast"
            else "quality" if profile_key == "quality"
            else "balanced"
        )
        return ["-c:v", "h264_amf", "-quality", quality]

    preset = job.get("speed_preset") or profile["preset"]
    threads = resolve_x264_threads(active_workers)
    return [
        "-c:v", "libx264",
        "-crf", str(profile["crf"]),
        "-preset", preset,
        "-threads", str(threads),
    ]


def _process_one(idx, job, ffmpeg_path, *, hw_encoder=None, ctx=None):
    temporal = isinstance(job, dict) and any(
        isinstance(op, dict) and str(op.get("mode") or "").lower() == "delogo"
        and str(op.get("delogo_method") or op.get("delogoMethod") or "").lower() in {"temporal", "inpaint"}
        for op in job.get("operations", []) or []
    )
    if not temporal:
        return _process_one_impl(idx, job, ffmpeg_path, hw_encoder=hw_encoder, ctx=ctx)
    try:
        with tempfile.TemporaryDirectory(prefix="beru-temporal-") as directory:
            return _process_one_impl(
                idx, job, ffmpeg_path, hw_encoder=hw_encoder, ctx=ctx,
                temporal_directory=directory,
            )
    except Exception as exc:
        job_id = job.get("id", idx)
        if _check_cancelled(ctx):
            return _job_cancelled_result(job_id)
        return _job_failed_result(
            job_id, str(exc), max_workers=ctx.max_workers if ctx else _BATCH_ACTIVE_WORKERS,
        )


def _process_one_impl(idx, job, ffmpeg_path, *, hw_encoder=None, ctx=None,
                      temporal_directory=None):
    """Process a single job. Thread-safe.

    If hw_encoder is provided (from the batch pre-flight), it is used
    directly instead of re-detecting. This avoids per-job detection overhead
    and lets the batch-level pre-flight skip a broken GPU encoder for all jobs.

    ``ctx`` is the batch-scoped ``BatchContext``; when absent (direct calls,
    older tests) the module-level fallbacks are used.
    """
    active_workers = ctx.max_workers if ctx is not None else _BATCH_ACTIVE_WORKERS
    if ctx is not None:
        ffmpeg_path = ctx.ffmpeg_path
    if not isinstance(job, dict):
        logger.error("Job %d: invalid payload (expected object, got %s)", idx, type(job).__name__)
        return _job_failed_result(idx, "Invalid job payload", max_workers=active_workers)

    raw_job = job
    try:
        job = _validated_job_media(job, require_output=True)
    except ValueError as exc:
        logger.error("Job %d: rejected unsafe media path: %s", idx, exc)
        return _job_failed_result(
            job.get("id", idx), str(exc), max_workers=active_workers
        )

    input_path = job.get("input_path")
    output_path = job.get("output_path")
    fname = os.path.basename(input_path) if input_path else "unknown"
    job_id = job.get("id", idx)

    if _check_cancelled(ctx):
        return {"index": job_id, "status": "cancelled"}

    if not input_path or not os.path.exists(input_path):
        raw_err = f"Input not found: {input_path}"
        logger.error("Job %d: %s", idx, raw_err)
        return _job_failed_result(job_id, raw_err, max_workers=active_workers)

    if os.path.abspath(input_path) == os.path.abspath(output_path):
        raw_err = "Output would overwrite input file"
        logger.error("Job %d: output path equals input, skipping: %s", idx, input_path)
        return _job_failed_result(job_id, raw_err, max_workers=active_workers)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    raw_operations = job.get("operations", []) or []
    watermark = job.get("watermark")
    wm_enabled = isinstance(watermark, dict) and bool(watermark.get("enabled"))

    try:
        trim_start, trim_end = _parse_trim_window(job)
        if not math.isfinite(trim_start) or trim_start < 0:
            raise ValueError("invalid start")
        if trim_end is not None and (not math.isfinite(trim_end) or trim_end <= trim_start):
            raise ValueError("invalid end")
    except (TypeError, ValueError) as exc:
        return _job_failed_result(job_id, f"Invalid trim range: {exc}", max_workers=active_workers)
    trimmed = trim_start > 0 or trim_end is not None

    if _job_takes_copy_path(job):
        out_ext = os.path.splitext(output_path)[1].lower()
        src_audio_codec = (job.get("audio_codec") or "").lower()
        if _native_copy_eligible(input_path, output_path, ctx=ctx):
            ok, err = _native_stream_copy(input_path, output_path, ctx=ctx, job_id=job_id)
            if ok:
                logger.info("Job %d: native copy -> %s", idx, os.path.basename(output_path))
                _emit_job_complete(job_id, output_path)
                return {"index": job_id, "status": "succeeded"}
            remove_partial_output(output_path, input_path, logger=logger)
            if err == "Cancelled":
                return _job_cancelled_result(job_id)
            logger.warning("Job %d: native copy failed, remuxing instead: %s", idx, err)
        logger.debug("Job %d: no operations, copying stream", idx)
        copy_args = [ffmpeg_path, "-nostdin", "-xerror", "-y", "-loglevel", "error", "-progress", "pipe:2", "-nostats", "-i", input_path]
        if src_audio_codec and src_audio_codec not in _AUDIO_COPY_CODECS.get(out_ext, frozenset()):
            # Container cannot hold the source audio: re-encode audio, keep video copy.
            copy_args += ["-map", "0:v:0?", "-c:v", "copy"]
            copy_args += build_audio_args(output_path, src_audio_codec, job.get("audio_channels"))
        else:
            copy_args += ["-c", "copy"]
        if out_ext in _FASTSTART_EXTS:
            copy_args += ["-movflags", "+faststart"]
        copy_args += ["-max_muxing_queue_size", "1024"]
        copy_args.append(output_path)
        try:
            input_bytes = os.path.getsize(input_path)
        except OSError:
            input_bytes = 0
        copy_timeout = max(300, min(7200, int(input_bytes / (25 * 1024 * 1024))))
        ok, err = _run_ffmpeg(
            copy_args, timeout_sec=copy_timeout, job_id=job_id,
            duration_sec=float(job.get("video_duration") or 0), ctx=ctx,
        )
        if ok:
            logger.info("Job %d: copied -> %s", idx, os.path.basename(output_path))
            _emit_job_complete(job_id, output_path)
            return {"index": job_id, "status": "succeeded"}
        logger.error("Job %d: copy failed: %s", idx, err)
        remove_partial_output(output_path, input_path, logger=logger)
        if err == "Cancelled":
            return _job_cancelled_result(job_id)
        return _job_failed_result(job_id, err, max_workers=active_workers)

    info = job_video_info(job, input_path, ctx=ctx)
    vw, vh = _job_dimensions(job, info)
    duration = float(info.get("duration") or 0)
    output_duration = duration
    if vw <= 0 or vh <= 0:
        probe_path = ctx.ffprobe_path if ctx is not None else FFPROBE
        ffprobe_status = f"ffprobe={probe_path}" if probe_path else "ffprobe no configurado"
        err = (
            "No se pudo leer la resolución del video: ffprobe no encontró dimensiones válidas "
            f"para '{fname}' ({ffprobe_status})."
        )
        logger.error("Job %d: invalid dimensions %dx%d for %s", idx, vw, vh, fname)
        return _job_failed_result(job_id, err, max_workers=active_workers)

    operations = [_normalize_operation(op) for op in raw_operations]
    temporal_fps = float(info.get("frame_rate") or 0)
    if temporal_directory and temporal_fps <= 0:
        temporal_fps = float(media_probe.ffprobe(
            input_path, ffmpeg_bin=ffmpeg_path,
            ffprobe_bin=ctx.ffprobe_path if ctx else find_ffprobe(ffmpeg_path),
        ).get("frame_rate") or 0)
    temporal_resolver = TemporalPatchResolver(
        input_path, temporal_directory, ffmpeg_path, temporal_fps,
        source_format=info.get("pix_fmt"), ctx=ctx,
    ) if temporal_directory else None

    filter_complex, output_label, image_paths = build_filter_complex(
        operations, vw, vh, watermark=watermark, _ffmpeg_path=ffmpeg_path,
        source_pix_fmt=info.get("pix_fmt"), temporal_resolver=temporal_resolver,
    )

    if not filter_complex and (operations or wm_enabled):
        err = (
            "Las operaciones no generaron un filtro válido. "
            "Comprueba que cada región tenga tamaño suficiente y esté dentro del video."
        )
        logger.error("Job %d: empty filter graph with %d ops", idx, len(operations))
        return _job_failed_result(job_id, err, max_workers=active_workers)

    if trimmed:
        trim_window = f"start={trim_start:.6f}"
        if trim_end is not None:
            trim_window += f":end={trim_end:.6f}"
        trim_filter = f"trim={trim_window},setpts=PTS-STARTPTS[trimmed]"
        filter_complex = (
            f"{filter_complex};{output_label}{trim_filter}"
            if filter_complex else f"[0:v]{trim_filter}"
        )
        output_label = "[trimmed]"
        output_duration = (trim_end if trim_end is not None else duration) - trim_start

    src_pix_fmt = info.get("pix_fmt") or job.get("pix_fmt", "yuv420p")
    src_audio_codec = info.get("audio_codec") or job.get("audio_codec", "")
    encode_profile = job.get("encode_profile", "balanced")
    hw_failed = bool(raw_job.get("_hw_failed"))
    if hw_failed or not profile_allows_hardware(encode_profile):
        local_hw_encoder = None
    elif ctx is not None:
        local_hw_encoder = ctx.hw_encoder
    elif hw_encoder is not None:
        local_hw_encoder = hw_encoder
    else:
        local_hw_encoder = detect_hw_encoder(ffmpeg_path)

    def _build_cmd(force_software=False):
        loglevel = "info" if duration > 0 else "error"
        cmd = [ffmpeg_path, "-nostdin", "-xerror", "-y", "-loglevel", loglevel, "-progress", "pipe:2", "-nostats"]
        cmd += ["-i", input_path]
        for img_path in image_paths:
            cmd += extra_media_input_args(img_path, duration=duration, image_fps=1)
        cmd += build_filter_thread_args(active_workers)
        cmd += ["-filter_complex", filter_complex, "-map", output_label]
        if image_paths:
            cmd += ["-shortest"]
        cmd += build_encode_args(
            ffmpeg_path, encode_profile, job, force_software=force_software,
            hw_encoder=local_hw_encoder, active_workers=active_workers,
        )
        cmd += ["-pix_fmt", src_pix_fmt or "yuv420p"]
        if trimmed:
            cmd += ["-af", f"atrim={trim_window},asetpts=PTS-STARTPTS"]
        cmd += build_audio_args(
            output_path, src_audio_codec, info.get("audio_channels") or job.get("audio_channels"),
            force_encode=trimmed,
        )
        out_ext = os.path.splitext(output_path)[1].lower()
        if out_ext in _FASTSTART_EXTS:
            cmd += ["-movflags", "+faststart"]
        cmd += ["-max_muxing_queue_size", "1024"]
        cmd.append(output_path)
        return cmd

    logger.info(
        "Job %d: processing '%s' [%dx%d, %d ops, profile=%s, encoder=%s]",
        idx, fname, vw, vh, len(operations), encode_profile,
        local_hw_encoder or "libx264",
    )

    estimated_timeout = max(600, min(7200, int(duration * 2 + 300)))

    ok, err = _run_ffmpeg(
        _build_cmd(force_software=local_hw_encoder is None),
        timeout_sec=estimated_timeout,
        job_id=job_id,
        duration_sec=output_duration,
        ctx=ctx,
    )

    if not ok and local_hw_encoder is not None and is_hardware_encode_error(err):
        logger.warning("Job %d: hardware path failed, retrying with libx264", idx)
        raw_job["_hw_failed"] = True
        admission = (
            ctx.sw_fallback_admission if ctx is not None else _SOFTWARE_FALLBACK_ADMISSION
        )
        if admission is not None and not admission.acquire():
            return _job_cancelled_result(job_id)
        try:
            ok, err = _run_ffmpeg(
                _build_cmd(force_software=True),
                timeout_sec=estimated_timeout,
                job_id=job_id,
                duration_sec=output_duration,
                ctx=ctx,
            )
        finally:
            if admission is not None:
                admission.release()

    if ok:
        logger.info("Job %d: completed -> %s", idx, os.path.basename(output_path))
        _emit_job_complete(job_id, output_path)
        return {"index": job_id, "status": "succeeded"}
    logger.error("Job %d: ffmpeg failed: %s", idx, err[:200] if err else "")
    remove_partial_output(output_path, input_path, logger=logger)
    if err == "Cancelled":
        return _job_cancelled_result(job_id)
    return _job_failed_result(job_id, err or "Unknown error", max_workers=active_workers)


def _execute_batch(
    jobs,
    ctx,
    *,
    emit_batch_progress=True,
    copy_workers=None,
    defer_retryable=False,
):
    """Run one concurrent pass; returns per-job results and failure list.

    With defer_retryable, failures a retry pass will take stay unreported so
    the renderer never sees an error that a later pass turns into success.

    Stream-copy jobs (no operations, watermark, or trim) run on a separate
    bounded pool: a remux is pure disk I/O, so it neither deserves an encode
    slot nor benefits from sharing the encode concurrency cap.
    """
    ffmpeg_path = ctx.ffmpeg_path
    max_workers = ctx.max_workers
    hw_encoder = ctx.hw_encoder
    total = len(jobs)
    results = {}
    state = {"succeeded": 0, "failed": 0, "cancelled": 0, "completed": 0}
    state_lock = threading.Lock()
    admission_cond = threading.Condition()

    pending = {"encode": deque(), "copy": deque()}
    for i, job in enumerate(jobs):
        key = "copy" if _job_takes_copy_path(job) else "encode"
        pending[key].append((i, job))

    if pending["copy"]:
        if copy_workers is None:
            copy_workers = resolve_copy_workers(
                len(pending["copy"]), env=ctx.env
            )
        copy_workers = max(1, min(copy_workers, len(pending["copy"])))
    else:
        copy_workers = 0

    pools = {
        "encode": {"cap": max(1, max_workers), "outstanding": 0},
        "copy": {"cap": copy_workers, "outstanding": 0},
    }

    def _job_ram_estimate_mb(job, pool):
        """Peak-RAM estimate for the job about to be dispatched."""
        if pool == "copy":
            return _REMUX_JOB_RAM_MB
        profile = job.get("encode_profile", "balanced") if isinstance(job, dict) else "balanced"
        hw_failed = isinstance(job, dict) and bool(job.get("_hw_failed"))
        job_hw = hw_encoder if profile_allows_hardware(profile) and not hw_failed else None
        return _estimate_job_ram_mb(job, job_hw, _job_requires_encode(job), profile)

    def _memory_allows_another(job_ram_mb):
        """RAM gate for dispatching the next job.

        Always admits when no job is running (progress guarantee: even on a
        permanently tight machine, one job at a time still finishes) and when
        RAM cannot be measured. Worker sizing happens once at batch start via
        _memory_cap_workers; this gate handles RAM drifting DURING the batch.
        """
        if pools["encode"]["outstanding"] + pools["copy"]["outstanding"] <= 0:
            return True
        avail_mb = _get_available_ram_mb()
        if avail_mb <= 0:
            return True
        return avail_mb >= job_ram_mb

    def _try_acquire(pool_name, job):
        """Grab a pool slot when concurrency and RAM headroom allow."""
        with admission_cond:
            pool = pools[pool_name]
            if pool["outstanding"] >= pool["cap"]:
                return False
            if not _memory_allows_another(_job_ram_estimate_mb(job, pool_name)):
                return False
            pool["outstanding"] += 1
            return True

    def _release_admission(pool_name):
        with admission_cond:
            pools[pool_name]["outstanding"] -= 1
            admission_cond.notify_all()

    def _on_done(fut):
        _release_admission(getattr(fut, "_beru_pool", "encode"))
        try:
            result = fut.result()
        except Exception as e:
            job_pos = getattr(fut, "_beru_job_pos", -1)
            job = jobs[job_pos] if 0 <= job_pos < total else None
            job_id = job.get("id", job_pos) if isinstance(job, dict) else job_pos
            result = _job_failed_result(job_id, str(e), max_workers=max_workers)

        if result.get("status") == "failed" and not (
            defer_retryable and _should_retry_failed_job(result, max_workers)
        ):
            _emit_job_failed(result)

        with state_lock:
            idx = result.get("index", -1)
            results[idx] = result
            state["completed"] += 1
            status = result.get("status", "failed")
            if status == "succeeded":
                state["succeeded"] += 1
            elif status == "cancelled":
                state["cancelled"] += 1
            else:
                state["failed"] += 1

            if emit_batch_progress:
                job_pos = getattr(fut, "_beru_job_pos", -1)
                if 0 <= job_pos < total:
                    job = jobs[job_pos]
                    fname = os.path.basename(job.get("input_path", "")) if isinstance(job, dict) else "?"
                else:
                    fname = "?"
                _emit_batch_progress(state, total, fname)

    def _mark_cancelled(job, i):
        job_id = job.get("id", i) if isinstance(job, dict) else i
        with state_lock:
            if job_id not in results:
                results[job_id] = {"index": job_id, "status": "cancelled"}
                state["cancelled"] += 1
                state["completed"] += 1
                if emit_batch_progress:
                    fname = os.path.basename(job.get("input_path", "")) if isinstance(job, dict) else "?"
                    _emit_batch_progress(state, total, fname)
        _safe_print(json.dumps({
            "type": "cancelled", "index": job_id,
        }))

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=max(1, max_workers) + copy_workers
    ) as executor:
        futures = []
        while pending["encode"] or pending["copy"]:
            if _check_cancelled(ctx):
                break
            progressed = False
            for name in ("encode", "copy"):
                queue = pending[name]
                if not queue or not _try_acquire(name, queue[0][1]):
                    continue
                i, job = queue.popleft()
                try:
                    fut = executor.submit(
                        _process_one, i, job, ffmpeg_path,
                        ctx=ctx,
                    )
                except Exception:
                    _release_admission(name)
                    raise
                fut._beru_job_pos = i
                fut._beru_pool = name
                fut.add_done_callback(_on_done)
                futures.append(fut)
                progressed = True
            if not progressed:
                with admission_cond:
                    admission_cond.wait(timeout=1.0)

        for name in ("encode", "copy"):
            while pending[name]:
                i, job = pending[name].popleft()
                _mark_cancelled(job, i)

        concurrent.futures.wait(futures)

    failed_jobs = []
    for i, job in enumerate(jobs):
        if not isinstance(job, dict):
            continue
        job_id = job.get("id", i)
        result = results.get(job_id)
        if result and result.get("status") == "failed":
            failed_jobs.append((job, result))

    return {
        **state,
        "results": results,
        "failed_jobs": failed_jobs,
    }


_HW_ENCODER_UNSET = object()


def process_jobs(jobs, ffmpeg_path, max_workers=None, *, hw_encoder=_HW_ENCODER_UNSET, ctx=None):
    """Process jobs concurrently. Report progress to stdout.

    Args:
        hw_encoder: If provided (from batch pre-flight), it is used directly
            for profiles that allow hardware encoding.
        ctx: State of this run, shared by every Job and retry pass. When
            omitted, a fresh context captures the process defaults.
    """
    if ctx is not None and hw_encoder is _HW_ENCODER_UNSET:
        hw_encoder = ctx.hw_encoder
    if ctx is None:
        ctx = BatchContext(ffmpeg_path=ffmpeg_path, ffprobe_path=FFPROBE)
    ffmpeg_path = ctx.ffmpeg_path

    if _jobs_require_fonts(jobs):
        reset_caches()
        get_system_fonts()

    if not _jobs_allow_hardware(jobs):
        hw = None
    elif hw_encoder is _HW_ENCODER_UNSET:
        hw = detect_hw_encoder(ffmpeg_path, env=ctx.env)
    else:
        hw = hw_encoder
    max_pixels = 0
    has_video_filters = False
    encode_profiles = set()
    for job in jobs:
        if not isinstance(job, dict):
            continue
        w = int(job.get("source_width") or job.get("width") or 0)
        h = int(job.get("source_height") or job.get("height") or 0)
        if w > 0 and h > 0:
            max_pixels = max(max_pixels, w * h)
        if job.get("operations"):
            has_video_filters = True
        profile = (job.get("encode_profile") or "").strip().lower()
        if profile:
            encode_profiles.add(profile)

    encode_profile = (
        "uquality" if "uquality" in encode_profiles else
        "quality" if "quality" in encode_profiles else
        "balanced" if "balanced" in encode_profiles else
        "fast" if "fast" in encode_profiles else
        (ctx.env.get("BERU_ENCODE_PROFILE") or "balanced")
    )
    effective_hw = resolve_effective_hw_encoder(encode_profile, hw)

    if max_workers is None:
        max_workers = resolve_max_workers(
            effective_hw,
            len(jobs),
            max_pixels,
            has_video_filters=has_video_filters,
            encode_profile=encode_profile,
            jobs=jobs,
            env=ctx.env,
        )

    per_job_ram_mb = _max_estimated_job_ram_mb(
        jobs, effective_hw, has_video_filters, encode_profile
    )

    ctx.hw_encoder = hw
    ctx.max_workers = max(1, max_workers)
    if hw:
        software_workers = resolve_max_workers(
            None,
            len(jobs),
            max_pixels,
            has_video_filters=has_video_filters,
            encode_profile=encode_profile,
            jobs=jobs,
            env=ctx.env,
        )
        software_ram_mb = _max_estimated_job_ram_mb(
            jobs, None, has_video_filters, encode_profile
        )
        ctx.sw_fallback_admission = _ResourceAdmission(
            min(max_workers, software_workers), software_ram_mb, ctx=ctx
        )
    else:
        ctx.sw_fallback_admission = None

    total = len(jobs)
    copy_workers = resolve_copy_workers(
        sum(1 for job in jobs if _job_takes_copy_path(job)), env=ctx.env
    )
    mode = (ctx.env.get("BERU_WORKERS_MODE") or "balanced").strip().lower()
    logger.info(
        "Starting batch: %d jobs, %d encode workers + %d copy workers "
        "(mode=%s, encoder=%s, max_px=%d, "
        "est_ram_per_job=%dMB, avail_ram=%dMB), ffmpeg=%s",
        total, max_workers, copy_workers, mode, effective_hw or "libx264", max_pixels,
        per_job_ram_mb, _get_available_ram_mb(), ffmpeg_path,
    )

    retry_enabled = _retry_failed_enabled(env=ctx.env) and max_workers > 1
    pass1 = _execute_batch(
        jobs,
        ctx,
        emit_batch_progress=True,
        copy_workers=copy_workers,
        defer_retryable=retry_enabled,
    )
    succeeded = pass1["succeeded"]
    failed = pass1["failed"]
    cancelled = pass1["cancelled"]

    retry_pairs = [
        (job, result) for job, result in pass1["failed_jobs"]
        if _should_retry_failed_job(result, max_workers)
    ]
    retry_candidates = [job for job, _result in retry_pairs]
    if retry_enabled and retry_candidates and _check_cancelled(ctx):
        for _job, result in retry_pairs:
            _emit_job_failed(result)
    elif retry_enabled and retry_candidates:
        resource_retry = any(
            is_resource_pressure_error((result.get("raw_error") or result.get("error") or ""))
            for _job, result in pass1["failed_jobs"]
            if _should_retry_failed_job(result, max_workers)
        )
        reduced_workers = 1 if resource_retry else max(1, max_workers // 2)
        logger.info(
            "Retry pass: %d failed jobs at %d workers (was %d)",
            len(retry_candidates), reduced_workers, max_workers,
        )
        retry_ctx = replace(ctx, max_workers=max(1, reduced_workers))
        pass2 = _execute_batch(
            retry_candidates,
            retry_ctx,
            emit_batch_progress=False,
            copy_workers=resolve_copy_workers(
                sum(1 for job in retry_candidates if _job_takes_copy_path(job)), env=ctx.env
            ),
        )
        # pass2 result keys are job.get("id", position-within-retry-list), so
        # look up by retry index — jobs without an id must still be recounted.
        for pos, (_job, prev) in enumerate(retry_pairs):
            job_key = _job.get("id", pos)
            new = pass2["results"].get(job_key)
            if not prev or prev.get("status") != "failed":
                continue
            failed -= 1
            if new and new.get("status") == "succeeded":
                succeeded += 1
            elif new and new.get("status") == "cancelled":
                cancelled += 1
            else:
                failed += 1

    logger.info("Batch finished: %d/%d succeeded, %d failed, %d cancelled",
                succeeded, total, failed, cancelled)
    return {
        "total": total,
        "succeeded": succeeded,
        "failed": failed,
        "cancelled": cancelled,
        "workers": max_workers,
        "copy_workers": copy_workers,
    }


def render_preview_frame(payload):
    """Render one video frame with export-equivalent filters.

    Returns a dict: {ok, data_url?, error?, width?, height?, timestamp?}
    """
    return preview.render_frame(
        payload, source_only=False, ffmpeg_path=FFMPEG, probe_fn=ffprobe,
        info_fn=job_video_info, filter_fn=build_filter_complex,
    )


def render_source_frame(payload):
    """Decode one frame straight from a rendered artifact (no filter graph)."""
    return preview.render_frame(
        payload, source_only=True, ffmpeg_path=FFMPEG, probe_fn=ffprobe,
        info_fn=job_video_info, filter_fn=build_filter_complex,
    )


def preview_frame_worker_main():
    """Serve preview requests as newline-delimited JSON over stdin/stdout."""
    if not _init_ffmpeg_globals():
        print(json.dumps({"type": "ready", "ok": False, "error": "ffmpeg not found"}), flush=True)
        return

    get_system_fonts()
    print(json.dumps({"type": "ready", "ok": True}), flush=True)

    while line := sys.stdin.buffer.readline(PREVIEW_MAX_REQUEST_BYTES + 1):
        if len(line) > PREVIEW_MAX_REQUEST_BYTES:
            return
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            payload = request.get("payload")
            if not isinstance(request_id, int) or not isinstance(payload, dict):
                raise ValueError("Invalid preview request")
            if payload.get("source_only"):
                result = render_source_frame(payload)
            else:
                result = render_preview_frame(payload)
        except Exception as exc:
            result = {"ok": False, "error": str(exc)}

        print(json.dumps({"id": request_id, **result}), flush=True)


def _load_jobs_manifest(jobs_path):
    """Read and validate a jobs manifest file. Returns the jobs list."""
    with open(jobs_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        logger.error("Invalid jobs file: expected array or {jobs:[]}")
        raise ValueError("Invalid jobs manifest")

    manifest_type = payload.get("type")
    manifest_version = payload.get("version")
    if manifest_type != JOB_MANIFEST_TYPE:
        logger.error("Invalid jobs manifest type: %s", manifest_type)
        raise ValueError("Invalid jobs manifest type")
    if manifest_version != JOB_MANIFEST_VERSION:
        logger.error("Unsupported jobs manifest version: %s", manifest_version)
        raise ValueError("Unsupported jobs manifest version")
    if not isinstance(payload.get("jobs"), list):
        logger.error("Invalid jobs manifest: jobs must be an array")
        raise ValueError("Invalid jobs manifest")
    return payload["jobs"]


def _preflight_hw_encoder(jobs, *, verified, ctx=None):
    """Real-encode probe runs until an encoder verifies; failures re-probe."""
    if not _jobs_allow_hardware(jobs):
        return None, verified
    hw = detect_hw_encoder(
        ctx.ffmpeg_path if ctx is not None else FFMPEG,
        force_test=not verified, env=ctx.env if ctx is not None else None,
    )
    if hw is None:
        logger.info("Hardware encoder pre-flight failed; using software (libx264) for batch")
    return hw, hw is not None


def job_worker_main():
    """Serve processing runs as newline-delimited JSON over stdin/stdout.

    Each request is {"id": int, "jobs_file": path, "env": {str: str}}. Run
    events keep the single-shot NDJSON contract verbatim; every request ends
    with {"type": "run_end", "id": ..., "ok": bool} so the caller can tell a
    finished run from a dead worker.
    """
    if not _init_ffmpeg_globals():
        print(json.dumps({"type": "ready", "ok": False, "error": "ffmpeg not found"}), flush=True)
        return
    print(json.dumps({"type": "ready", "ok": True}), flush=True)

    hw_verified = False
    base_env = dict(os.environ)
    while line := sys.stdin.buffer.readline(JOB_WORKER_MAX_REQUEST_BYTES + 1):
        if len(line) > JOB_WORKER_MAX_REQUEST_BYTES:
            return
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            jobs_file = request.get("jobs_file")
            env = request.get("env") or {}
            if (
                not isinstance(request_id, int)
                or not isinstance(jobs_file, str)
                or not isinstance(env, dict)
            ):
                raise ValueError("Invalid job request")
            ctx = BatchContext(
                ffmpeg_path=FFMPEG, ffprobe_path=FFPROBE, jobs_file=jobs_file,
                env={**base_env, **{
                    key: value for key, value in env.items()
                    if isinstance(key, str) and isinstance(value, str)
                }},
            )
            jobs = _load_jobs_manifest(jobs_file)
            preflight_hw, hw_verified = _preflight_hw_encoder(
                jobs, verified=hw_verified, ctx=ctx
            )
            result = process_jobs(jobs, FFMPEG, hw_encoder=preflight_hw, ctx=ctx)
            _safe_print(json.dumps({"type": "summary", **result}))
            _safe_print(json.dumps({
                "type": "run_end", "id": request_id,
                "ok": result["failed"] == 0 and result["cancelled"] == 0,
            }))
        except Exception as exc:
            logger.exception("Job worker request failed")
            _safe_print(json.dumps({"type": "error", "error": str(exc)}))
            _safe_print(json.dumps(
                {"type": "run_end", "id": request_id, "ok": False, "error": str(exc)}
            ))


def main():
    if sys.platform != "win32":
        raise RuntimeError("Beru solo admite Windows.")

    protect_process_tree()

    if len(sys.argv) >= 2 and sys.argv[1] == "--preview-frame-worker":
        preview_frame_worker_main()
        return

    if len(sys.argv) >= 2 and sys.argv[1] == "--job-worker":
        job_worker_main()
        return

    if len(sys.argv) < 2:
        logger.error("Missing jobs.json argument")
        print(json.dumps({"type": "error", "error": "Usage: processor.py <jobs.json>"}))
        sys.exit(1)

    if not _init_ffmpeg_globals():
        print(json.dumps({"type": "error", "error": f"ffmpeg not found at {find_ffmpeg()}"}))
        sys.exit(1)

    try:
        jobs = _load_jobs_manifest(sys.argv[1])
    except Exception as exc:
        logger.error("Invalid jobs file: %s", exc)
        print(json.dumps({"type": "error", "error": str(exc)}))
        sys.exit(1)

    ctx = BatchContext(ffmpeg_path=FFMPEG, ffprobe_path=FFPROBE, jobs_file=sys.argv[1])
    preflight_hw, _ = _preflight_hw_encoder(jobs, verified=False, ctx=ctx)
    result = process_jobs(jobs, FFMPEG, hw_encoder=preflight_hw, ctx=ctx)
    print(json.dumps({"type": "summary", **result}))
    sys.exit(1 if result["failed"] else 130 if result["cancelled"] else 0)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logging.getLogger("beru").exception("Fatal processor error")
        print(json.dumps({"type": "error", "error": str(exc)}))
        sys.exit(1)
