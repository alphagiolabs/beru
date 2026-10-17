#!/usr/bin/env python3
"""Batch scheduling, per-job execution and CLI/NDJSON worker entrypoints.

Consumes JSON job manifests and emits progress as NDJSON on stdout.
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
import shutil
import threading
from collections import deque
from dataclasses import replace
from functools import partial
from pathlib import Path

import encoders
import filters
import fonts
import media_probe
import preview
import process_lifetime

from batch_errors import ProcessingCancelled, is_resource_pressure_error
from encode_profiles import (
    effective_hw_encoder as resolve_effective_hw_encoder,
    profile_allows_hardware,
)
from composition import process_composition
from clip_render import ClipRenderer, HardwareFallbackState
from stabilization import process_stabilization
from job_classify import (
    job_processing_stages,
    job_requires_encode,
    job_takes_copy_path,
    jobs_allow_hardware,
    jobs_require_fonts,
)
from capacity import (
    REMUX_JOB_RAM_MB,
    estimate_job_ram_mb,
    get_available_ram_mb,
    max_estimated_job_ram_mb,
    resolve_copy_workers,
    resolve_max_workers,
)
from batch_context import BatchContext, BatchScheduling, ResourceAdmission, default_cancel_event, check_cancelled
from ffmpeg_runner import (
    emit_batch_progress as report_batch_progress,
    emit_job_complete,
    emit_job_failed,
    job_cancelled_result,
    job_failed_result,
    retry_failed_enabled,
    safe_print,
    should_retry_failed_job,
)

JOB_MANIFEST_TYPE = "beru-job-manifest"
JOB_MANIFEST_VERSION = 1
PREVIEW_MAX_REQUEST_BYTES = preview.PREVIEW_MAX_REQUEST_BYTES
JOB_WORKER_MAX_REQUEST_BYTES = 64 * 1024


def setup_logging():
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


def _init_ffmpeg_globals():
    ffmpeg_bin = media_probe.find_ffmpeg()
    ffprobe_bin = media_probe.find_ffprobe(ffmpeg_bin)
    if not (os.path.isfile(ffmpeg_bin) or shutil.which(ffmpeg_bin)):
        logger.error("ffmpeg not found at %s", ffmpeg_bin)
        return False

    media_probe.FFMPEG = ffmpeg_bin
    media_probe.FFPROBE = ffprobe_bin
    logger.info("Using ffmpeg: %s", media_probe.FFMPEG)
    logger.info("Using ffprobe: %s", media_probe.FFPROBE)
    return True


def _new_hardware_fallback_states(jobs):
    return {id(job): HardwareFallbackState() for job in jobs}


def _process_one(idx, job, ffmpeg_path, *, hw_encoder=None, ctx=None,
                 hardware_fallback=None):
    job_id = job.get("id", idx) if isinstance(job, dict) else idx
    workers = ctx.scheduling.max_workers if ctx else 1
    if check_cancelled(ctx):
        return job_cancelled_result(job_id)
    try:
        if not isinstance(job, dict):
            raise ValueError("Invalid job payload")
        if ctx is None:
            encoder = hw_encoder
            if encoder is None and job_requires_encode(job) and jobs_allow_hardware([job]):
                encoder = encoders.detect_hw_encoder(ffmpeg_path)
            ctx = BatchContext(ffmpeg_path=ffmpeg_path, scheduling=BatchScheduling(hw_encoder=encoder),
                               cancel_event=default_cancel_event)
        if job.get("kind") == "stabilization":
            process_stabilization(job, ctx.ffmpeg_path, ctx=ctx)
        else:
            fallback = (
                hardware_fallback if hardware_fallback is not None else HardwareFallbackState()
            )
            if job.get("kind") == "composition":
                process_composition(job, ctx=ctx, hardware_fallback=fallback)
            else:
                renderer = ClipRenderer(ctx, hardware_fallback=fallback)
                renderer.render({**job, "id": job_id} if "id" not in job else job)
        emit_job_complete(job_id, job["output_path"])
        return {"index": job_id, "status": "succeeded"}
    except ProcessingCancelled:
        return job_cancelled_result(job_id)
    except Exception as exc:
        if check_cancelled(ctx):
            return job_cancelled_result(job_id)
        return job_failed_result(job_id, str(exc), max_workers=workers)


def _execute_batch(
    jobs,
    ctx,
    *,
    emit_batch_progress=True,
    copy_workers=None,
    defer_retryable=False,
    fallback_by_parent=None,
):
    if fallback_by_parent is None:
        fallback_by_parent = _new_hardware_fallback_states(jobs)
    ffmpeg_path = ctx.ffmpeg_path
    max_workers = ctx.scheduling.max_workers
    hw_encoder = ctx.scheduling.hw_encoder
    total = len(jobs)
    results = [None] * total
    state = {"succeeded": 0, "failed": 0, "cancelled": 0, "completed": 0}
    state_lock = threading.Lock()
    admission_cond = threading.Condition()

    pending = {"encode": deque(), "copy": deque()}
    for i, job in enumerate(jobs):
        key = "copy" if job_takes_copy_path(job) else "encode"
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
        if pool == "copy":
            return REMUX_JOB_RAM_MB
        profile = job.get("encode_profile", "balanced") if isinstance(job, dict) else "balanced"
        hw_failed = fallback_by_parent[id(job)].hardware_failed
        job_hw = hw_encoder if profile_allows_hardware(profile) and not hw_failed else None
        return estimate_job_ram_mb(job, job_hw, job_requires_encode(job), profile)

    def _memory_allows_another(job_ram_mb):
        if pools["encode"]["outstanding"] + pools["copy"]["outstanding"] <= 0:
            return True
        avail_mb = get_available_ram_mb()
        if avail_mb <= 0:
            return True
        return avail_mb >= job_ram_mb

    def _try_acquire(pool_name, job):
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
            result = job_failed_result(job_id, str(e), max_workers=max_workers)

        if result.get("status") == "failed" and not (
            defer_retryable and should_retry_failed_job(result, max_workers)
        ):
            emit_job_failed(result)

        with state_lock:
            results[fut._beru_job_pos] = result
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
                report_batch_progress(state, total, fname)

    def _mark_cancelled(job, i):
        job_id = job.get("id", i) if isinstance(job, dict) else i
        with state_lock:
            if results[i] is None:
                results[i] = {"index": job_id, "status": "cancelled"}
                state["cancelled"] += 1
                state["completed"] += 1
                if emit_batch_progress:
                    fname = os.path.basename(job.get("input_path", "")) if isinstance(job, dict) else "?"
                    report_batch_progress(state, total, fname)
        safe_print(json.dumps({
            "type": "cancelled", "index": job_id,
        }))

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=max(1, max_workers) + copy_workers
    ) as executor:
        futures = []
        while pending["encode"] or pending["copy"]:
            if check_cancelled(ctx):
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
                        hardware_fallback=fallback_by_parent[id(job)],
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
        result = results[i]
        if result and result.get("status") == "failed":
            failed_jobs.append((job, result))

    return {
        **state,
        "results": results,
        "failed_jobs": failed_jobs,
    }


_HW_ENCODER_UNSET = object()


def process_jobs(jobs, ffmpeg_path=None, max_workers=None, *, hw_encoder=_HW_ENCODER_UNSET, ctx=None):
    """Process jobs concurrently. Report progress to stdout.

    Args:
        hw_encoder: If provided (from batch pre-flight), it is used directly
            for profiles that allow hardware encoding.
        ctx: Run inputs shared by every Job and retry pass. Scheduling is
            derived without changing this context. Without ctx, ffmpeg_path
            captures fresh process defaults; with ctx, it must match its tools.
    """
    if ctx is not None and ffmpeg_path is not None and ffmpeg_path != ctx.ffmpeg_path:
        raise ValueError("ffmpeg_path conflicts with ctx.ffmpeg_path")
    if ctx is None and ffmpeg_path is None:
        raise ValueError("Provide ctx or ffmpeg_path")
    if ctx is not None and hw_encoder is _HW_ENCODER_UNSET:
        hw_encoder = ctx.scheduling.hw_encoder
    if ctx is None:
        ctx = BatchContext(ffmpeg_path=ffmpeg_path, ffprobe_path=media_probe.FFPROBE)

    if jobs_require_fonts(jobs):
        fonts.reset_caches()
        fonts.get_system_fonts()

    if not jobs_allow_hardware(jobs):
        hw = None
    elif hw_encoder is _HW_ENCODER_UNSET:
        hw = encoders.detect_hw_encoder(ctx.ffmpeg_path, env=ctx.env)
    else:
        hw = hw_encoder
    max_pixels = 0
    has_video_filters = False
    encode_profiles = set()
    for job in [stage for value in jobs if isinstance(value, dict) for stage in job_processing_stages(value)]:
        if not isinstance(job, dict):
            continue
        w = int(job.get("source_width") or job.get("width") or 0)
        h = int(job.get("source_height") or job.get("height") or 0)
        if w > 0 and h > 0:
            max_pixels = max(max_pixels, w * h)
        if job_requires_encode(job):
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

    per_job_ram_mb = max_estimated_job_ram_mb(
        jobs, effective_hw, has_video_filters, encode_profile
    )

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
        software_ram_mb = max_estimated_job_ram_mb(
            jobs, None, has_video_filters, encode_profile
        )
        admission = ResourceAdmission(
            min(max_workers, software_workers), software_ram_mb, ctx=ctx
        )
    else:
        admission = None
    ctx = replace(ctx, scheduling=BatchScheduling(
        hw_encoder=hw, max_workers=max(1, max_workers), sw_fallback_admission=admission,
    ))

    total = len(jobs)
    copy_workers = resolve_copy_workers(
        sum(1 for job in jobs if job_takes_copy_path(job)), env=ctx.env
    )
    mode = (ctx.env.get("BERU_WORKERS_MODE") or "balanced").strip().lower()
    logger.info(
        "Starting batch: %d jobs, %d encode workers + %d copy workers "
        "(mode=%s, encoder=%s, max_px=%d, "
        "est_ram_per_job=%dMB, avail_ram=%dMB), ffmpeg=%s",
        total, max_workers, copy_workers, mode, effective_hw or "libx264", max_pixels,
        per_job_ram_mb, get_available_ram_mb(), ctx.ffmpeg_path,
    )

    retry_enabled = retry_failed_enabled(env=ctx.env) and max_workers > 1
    fallback_by_parent = _new_hardware_fallback_states(jobs)
    pass1 = _execute_batch(
        jobs,
        ctx,
        emit_batch_progress=True,
        copy_workers=copy_workers,
        defer_retryable=retry_enabled,
        fallback_by_parent=fallback_by_parent,
    )
    succeeded = pass1["succeeded"]
    failed = pass1["failed"]
    cancelled = pass1["cancelled"]

    retry_pairs = [
        (job, result) for job, result in pass1["failed_jobs"]
        if should_retry_failed_job(result, max_workers)
    ]
    retry_candidates = [{**job, "id": result["index"]} for job, result in retry_pairs]
    if retry_enabled and retry_candidates and check_cancelled(ctx):
        for _job, result in retry_pairs:
            emit_job_failed(result)
    elif retry_enabled and retry_candidates:
        resource_retry = any(
            is_resource_pressure_error((result.get("raw_error") or result.get("error") or ""))
            for _job, result in pass1["failed_jobs"]
            if should_retry_failed_job(result, max_workers)
        )
        reduced_workers = 1 if resource_retry else max(1, max_workers // 2)
        logger.info(
            "Retry pass: %d failed jobs at %d workers (was %d)",
            len(retry_candidates), reduced_workers, max_workers,
        )
        retry_ctx = replace(ctx, scheduling=replace(ctx.scheduling, max_workers=max(1, reduced_workers)))
        pass2 = _execute_batch(
            retry_candidates,
            retry_ctx,
            fallback_by_parent={
                id(retry): fallback_by_parent[id(job)]
                for retry, (job, _result) in zip(retry_candidates, retry_pairs)
            },
            emit_batch_progress=False,
            copy_workers=resolve_copy_workers(
                sum(1 for job in retry_candidates if job_takes_copy_path(job)), env=ctx.env
            ),
        )
        for (_job, prev), new in zip(retry_pairs, pass2["results"]):
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


def _render_frame(payload, *, source_only):
    probe = partial(media_probe.ffprobe_cached, ffmpeg_bin=media_probe.FFMPEG, ffprobe_bin=media_probe.FFPROBE)
    return preview.render_frame(
        payload, source_only=source_only, ffmpeg_path=media_probe.FFMPEG, probe_fn=probe,
        info_fn=partial(media_probe.job_video_info, probe_fn=probe),
        filter_fn=partial(filters.build_filter_complex, ffmpeg_path=media_probe.FFMPEG),
    )


def render_preview_frame(payload):
    return _render_frame(payload, source_only=False)


def render_source_frame(payload):
    return _render_frame(payload, source_only=True)


def preview_frame_worker_main():
    """Serve preview requests as newline-delimited JSON over stdin/stdout."""
    if not _init_ffmpeg_globals():
        print(json.dumps({"type": "ready", "ok": False, "error": "ffmpeg not found"}), flush=True)
        return

    fonts.get_system_fonts()
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
    if not jobs_allow_hardware(jobs):
        return None, verified
    hw = encoders.detect_hw_encoder(
        ctx.ffmpeg_path if ctx is not None else media_probe.FFMPEG,
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
                ffmpeg_path=media_probe.FFMPEG, ffprobe_path=media_probe.FFPROBE, jobs_file=jobs_file,
                env={**base_env, **{
                    key: value for key, value in env.items()
                    if isinstance(key, str) and isinstance(value, str)
                }},
            )
            jobs = _load_jobs_manifest(jobs_file)
            preflight_hw, hw_verified = _preflight_hw_encoder(
                jobs, verified=hw_verified, ctx=ctx
            )
            result = process_jobs(jobs, hw_encoder=preflight_hw, ctx=ctx)
            safe_print(json.dumps({"type": "summary", **result}))
            safe_print(json.dumps({
                "type": "run_end", "id": request_id,
                "ok": result["failed"] == 0 and result["cancelled"] == 0,
            }))
        except Exception as exc:
            logger.exception("Job worker request failed")
            safe_print(json.dumps({"type": "error", "error": str(exc)}))
            safe_print(json.dumps(
                {"type": "run_end", "id": request_id, "ok": False, "error": str(exc)}
            ))


def main():
    if sys.platform != "win32":
        raise RuntimeError("Beru solo admite Windows.")

    process_lifetime.protect_process_tree()

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
        print(json.dumps({"type": "error", "error": f"ffmpeg not found at {media_probe.find_ffmpeg()}"}))
        sys.exit(1)

    try:
        jobs = _load_jobs_manifest(sys.argv[1])
    except Exception as exc:
        logger.error("Invalid jobs file: %s", exc)
        print(json.dumps({"type": "error", "error": str(exc)}))
        sys.exit(1)

    ctx = BatchContext(ffmpeg_path=media_probe.FFMPEG, ffprobe_path=media_probe.FFPROBE, jobs_file=sys.argv[1])
    preflight_hw, _ = _preflight_hw_encoder(jobs, verified=False, ctx=ctx)
    result = process_jobs(jobs, hw_encoder=preflight_hw, ctx=ctx)
    print(json.dumps({"type": "summary", **result}))
    sys.exit(1 if result["failed"] else 130 if result["cancelled"] else 0)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logging.getLogger("beru").exception("Fatal processor error")
        print(json.dumps({"type": "error", "error": str(exc)}))
        sys.exit(1)
