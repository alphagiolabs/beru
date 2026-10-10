"""FFmpeg execution, retries and NDJSON progress.

Cancellation uses the run context, falling back to batch_context defaults.
"""

import json
import logging
import os
import re
import subprocess
import threading
import time
from collections import deque

from batch_context import _check_cancelled
from batch_errors import (
    format_processing_error,
    is_hardware_encode_error,
    is_resource_pressure_error,
    remove_partial_output,
)
from op_shared import _env_flag

logger = logging.getLogger("beru")

MAX_RETRIES = 2
RETRY_DELAYS = [2, 5]
MAX_STDERR_LINES = 256
MAX_STDERR_CHARS = 48_000
STALL_TIMEOUT_SEC = 120
# Jobs with progress tracking are guarded by STALL_TIMEOUT_SEC; the absolute
# deadline only bounds runaway runs, so it tolerates encodes down to 0.05x.
TRACKED_TIMEOUT_DURATION_FACTOR = 20
_tr_print_lock = threading.Lock()
_last_job_progress_emit = {}
_job_progress_lock = threading.Lock()
_FFMPEG_TIME_RE = re.compile(r"time=(\d+):(\d+):(\d+\.?\d*)")
_FFMPEG_SPEED_RE = re.compile(r"speed=\s*([0-9.]+)x")
_FFMPEG_FRAME_RE = re.compile(r"(?:^|\s)frame=\s*(\d+)")


def _safe_print(msg):
    """Thread-safe JSON print to stdout."""
    with _tr_print_lock:
        print(msg, flush=True)


def _emit_job_complete(job_id, output_path):
    _safe_print(json.dumps({"type": "complete", "index": job_id, "output": output_path}))


def _emit_batch_progress(state, total, fname):
    """Batch-level progress payload (shared by done/cancelled emission sites)."""
    _safe_print(json.dumps({
        "type": "progress",
        "current": state["completed"],
        "total": total,
        "file": fname,
        "succeeded": state["succeeded"],
        "failed": state["failed"],
    }))


def _job_failed_result(job_id, raw_error, *, max_workers=None):
    """Failed result; the batch emits it once no retry pass will take the Job."""
    user_error = format_processing_error(raw_error, max_workers=max_workers)
    result = {"index": job_id, "status": "failed", "error": user_error}
    if raw_error and raw_error != user_error:
        result["raw_error"] = str(raw_error)
    return result


def _emit_job_failed(result):
    payload = {"type": "error", "index": result["index"], "error": result["error"]}
    if result.get("raw_error"):
        payload["raw_error"] = result["raw_error"][-1000:]
    _safe_print(json.dumps(payload))


def _job_cancelled_result(job_id):
    _safe_print(json.dumps({"type": "cancelled", "index": job_id}))
    return {"index": job_id, "status": "cancelled"}


def _emit_job_progress(job_id, percent, speed, *, ctx=None):
    """Per-video encode progress (0-100) for the renderer (throttled ~1 Hz per job)."""
    if job_id is None:
        return
    pct = round(max(0.0, min(100.0, percent)), 1)
    now = time.monotonic()
    times = ctx.progress_times if ctx is not None else _last_job_progress_emit
    lock = ctx.progress_lock if ctx is not None else _job_progress_lock
    with lock:
        last_t = times.get(job_id, 0.0)
        if pct < 100.0 and (now - last_t) < 1.0:
            return
        times[job_id] = now
    _safe_print(json.dumps({
        "type": "job_progress",
        "index": job_id,
        "percent": pct,
        "speed": speed,
    }))


def _is_transient_error(stderr_text):
    """Heuristic: detect transient FFmpeg errors that warrant a retry."""
    markers = [
        "i/o error",
        "temporary failure", "resource temporarily unavailable",
        "connection reset", "broken pipe",
    ]
    lower = stderr_text.lower()
    return any(m in lower for m in markers)


class StderrBuffer:
    """Bounded stderr accumulator with constant-time append and eviction."""

    __slots__ = ("_buf", "_chars", "_max_chars")

    def __init__(self, max_lines=MAX_STDERR_LINES, max_chars=MAX_STDERR_CHARS):
        self._buf = deque(maxlen=max_lines)
        self._chars = 0
        self._max_chars = max_chars

    def append(self, line):
        line = line[-self._max_chars:]
        if len(self._buf) == self._buf.maxlen:
            self._chars -= len(self._buf[0])
        self._buf.append(line)
        self._chars += len(line)
        while self._chars > self._max_chars and len(self._buf) > 1:
            evicted = self._buf.popleft()
            self._chars -= len(evicted)

    def __len__(self):
        return len(self._buf)

    def join(self):
        return "".join(self._buf)


def _retry_failed_enabled(*, env=None):
    return _env_flag("BERU_RETRY_FAILED", True, env=env)


def _should_retry_failed_job(result, max_workers):
    if result.get("status") != "failed":
        return False
    err = result.get("raw_error") or result.get("error") or ""
    if is_hardware_encode_error(err):
        return True
    if max_workers > 1 and is_resource_pressure_error(err):
        return True
    return False


def _extract_error_line(stderr_text):
    """Extract the most relevant error line from FFmpeg stderr."""
    if len(stderr_text) > MAX_STDERR_CHARS:
        stderr_text = stderr_text[-MAX_STDERR_CHARS:]
    lines = stderr_text.split("\n")
    priority = ("invalid", "no such", "unable to parse")
    best_error = None
    best_any = None
    for line in reversed(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if best_any is None:
            best_any = stripped
        low = stripped.lower()
        if any(p in low for p in priority):
            return stripped[-400:]
        if best_error is None and "error" in low:
            best_error = stripped
    chosen = best_error or best_any or stderr_text.strip()
    return chosen[-400:] if chosen else ""


def _output_path_from_ffmpeg_cmd(cmd):
    """Last non-flag argv token is typically the output file."""
    if not cmd:
        return None
    for token in reversed(cmd):
        s = str(token)
        if s and not s.startswith("-"):
            return s
    return None


def _input_path_from_ffmpeg_cmd(cmd):
    """First path argument after -i."""
    if not cmd:
        return None
    args = [str(x) for x in cmd]
    for i, token in enumerate(args):
        if token == "-i" and i + 1 < len(args):
            candidate = args[i + 1]
            if candidate and not candidate.startswith("-"):
                return candidate
    return None


def _cleanup_ffmpeg_partial(cmd):
    output_path = _output_path_from_ffmpeg_cmd(cmd)
    if output_path:
        remove_partial_output(output_path, _input_path_from_ffmpeg_cmd(cmd), logger=logger)


def _should_retry_ffmpeg(stderr, attempt):
    if attempt >= MAX_RETRIES:
        return False
    return _is_transient_error(str(stderr or ""))


def _kill_ffmpeg_process(proc):
    if proc.poll() is not None:
        return
    try:
        proc.kill()
    except OSError:
        if proc.poll() is None:
            raise
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.terminate()
        proc.wait(timeout=2)


def _run_ffmpeg_stream(cmd, timeout_sec, job_id=None, duration_sec=0.0, *, ctx=None):
    """Run FFmpeg with bounded stderr capture, optional progress parsing, and cancel polling."""
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=dict(ctx.env) if ctx is not None else None,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    stderr_lines = StderrBuffer()
    stderr_lock = threading.Lock()
    reader_done = threading.Event()
    progress_state = {
        "seconds": -1.0, "frame": -1,
        "advanced_at": time.monotonic(), "reader_error": None, "speed": None,
    }

    def read_stderr():
        try:
            if proc.stderr is None:
                return
            for line in iter(lambda: proc.stderr.readline(4096), ""):
                with stderr_lock:
                    stderr_lines.append(line)
                m = _FFMPEG_TIME_RE.search(line)
                cur = None
                if m:
                    cur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
                elif line.startswith("out_time_us="):
                    value = line.strip().partition("=")[2]
                    if value.lstrip("-").isdigit():
                        cur = int(value) / 1_000_000
                frame = _FFMPEG_FRAME_RE.search(line)
                with stderr_lock:
                    if cur is not None and cur > progress_state["seconds"]:
                        progress_state["seconds"] = cur
                        progress_state["advanced_at"] = time.monotonic()
                    if frame and int(frame.group(1)) > progress_state["frame"]:
                        progress_state["frame"] = int(frame.group(1))
                        progress_state["advanced_at"] = time.monotonic()
                if cur is None or job_id is None:
                    sm = _FFMPEG_SPEED_RE.search(line)
                    if sm:
                        progress_state["speed"] = float(sm.group(1))
                    continue
                pct = min(99.0, (cur / duration_sec) * 100.0) if duration_sec > 0 else 0
                sm = _FFMPEG_SPEED_RE.search(line)
                speed = float(sm.group(1)) if sm else progress_state["speed"]
                _emit_job_progress(job_id, pct, speed, ctx=ctx)
        except Exception as exc:
            with stderr_lock:
                progress_state["reader_error"] = f"FFmpeg progress reader failed: {exc}"
        finally:
            try:
                if proc.stderr is not None:
                    proc.stderr.close()
            except OSError as exc:
                with stderr_lock:
                    progress_state["reader_error"] = f"FFmpeg stderr close failed: {exc}"
            finally:
                reader_done.set()

    deadline = time.monotonic() + timeout_sec
    stall_enabled = job_id is not None
    failure = None

    try:
        threading.Thread(target=read_stderr, daemon=True).start()
        while True:
            with stderr_lock:
                reader_error = progress_state["reader_error"]
                last_advance = progress_state["advanced_at"]
            if reader_error:
                failure = reader_error
                break
            returncode = proc.poll()
            if returncode is not None:
                break
            if _check_cancelled(ctx):
                failure = "Cancelled"
                break
            now = time.monotonic()
            if now >= deadline:
                failure = f"Timeout after {timeout_sec}s"
                break
            if stall_enabled and now - last_advance > STALL_TIMEOUT_SEC:
                failure = f"FFmpeg stalled (no progress for {STALL_TIMEOUT_SEC}s)"
                break
            try:
                proc.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                pass
    finally:
        if proc.poll() is None:
            _kill_ffmpeg_process(proc)
        if not reader_done.wait(timeout=2):
            failure = failure or "FFmpeg stderr did not close"
    with stderr_lock:
        stderr = stderr_lines.join()
        failure = failure or progress_state["reader_error"]

    if failure:
        _cleanup_ffmpeg_partial(cmd)
        detail = _extract_error_line(stderr)
        return False, failure if failure == "Cancelled" or not detail else f"{failure}: {detail}"

    if returncode == 0:
        output = _output_path_from_ffmpeg_cmd(cmd) if _input_path_from_ffmpeg_cmd(cmd) else None
        if output and (not os.path.isfile(output) or os.path.getsize(output) == 0):
            return False, "FFmpeg exited with code 0 but produced no valid output file"
        if job_id is not None:
            _emit_job_progress(job_id, 100.0, None, ctx=ctx)
        return True, None
    detail = _extract_error_line(stderr)
    return False, f"FFmpeg exited with code {returncode}" + (f": {detail}" if detail else "")


def _run_ffmpeg(cmd, timeout_sec=600, job_id=None, duration_sec=0.0, *, ctx=None):
    """Run ffmpeg with retry for transient failures.

    The timeout scales with video duration when duration_sec is provided:
    at least timeout_sec, or 3x the video duration (20x for Jobs with
    progress tracking, which the stall check already guards). A timeout is
    not transient, so it never triggers a retry.
    """
    if duration_sec > 0:
        factor = TRACKED_TIMEOUT_DURATION_FACTOR if job_id is not None else 3
        timeout_sec = max(timeout_sec, int(duration_sec * factor))
    for attempt in range(MAX_RETRIES + 1):
        if _check_cancelled(ctx):
            _cleanup_ffmpeg_partial(cmd)
            return False, "Cancelled"
        try:
            logger.debug("FFmpeg cmd: %s", " ".join(str(x) for x in cmd)[:500])
            t0 = time.perf_counter()
            ok, err = _run_ffmpeg_stream(cmd, timeout_sec, job_id, duration_sec, ctx=ctx)
            elapsed = time.perf_counter() - t0
            if ok:
                logger.info("FFmpeg finished in %.1fs (job=%s)", elapsed, job_id)
                return True, None
            stderr = err or ""
            if _should_retry_ffmpeg(stderr, attempt):
                _cleanup_ffmpeg_partial(cmd)
                logger.warning("Transient error, retry %d/%d: %s",
                               attempt + 1, MAX_RETRIES, (stderr or "")[:150])
                _wait_retry(RETRY_DELAYS[attempt], ctx)
                continue
            _cleanup_ffmpeg_partial(cmd)
            return False, stderr if stderr else "Unknown error"
        except Exception as e:
            _cleanup_ffmpeg_partial(cmd)
            if attempt < MAX_RETRIES:
                logger.warning("Exception, retry %d/%d: %s", attempt + 1, MAX_RETRIES, e)
                _wait_retry(RETRY_DELAYS[attempt], ctx)
                continue
            return False, str(e)


def _wait_retry(delay, ctx):
    deadline = time.monotonic() + delay
    while not _check_cancelled(ctx):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        if ctx is None:
            time.sleep(min(0.2, remaining))
        else:
            ctx.cancel_event.wait(min(0.2, remaining))


def _native_stream_copy(input_path, output_path, *, ctx=None, job_id=None):
    """Chunked byte copy with cooperative cancellation. Returns (ok, err)."""
    try:
        total_bytes = os.path.getsize(input_path)
        copied_bytes = 0
        with open(input_path, "rb") as fin, open(output_path, "wb") as fout:
            buffer = bytearray(min(8 * 1024 * 1024, max(1, total_bytes)))
            view = memoryview(buffer)
            while True:
                if _check_cancelled(ctx):
                    return False, "Cancelled"
                count = fin.readinto(buffer)
                if not count:
                    _emit_job_progress(job_id, 100, None, ctx=ctx)
                    return True, None
                fout.write(view[:count])
                copied_bytes += count
                _emit_job_progress(job_id, min(99, copied_bytes * 100 / max(1, total_bytes)), None, ctx=ctx)
    except OSError as exc:
        return False, str(exc)
