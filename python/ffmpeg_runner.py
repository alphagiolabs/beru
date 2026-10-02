"""FFmpeg execution, retries and NDJSON progress.

Cancellation uses the run context, falling back to batch_context defaults.
"""

import json
import logging
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
_tr_print_lock = threading.Lock()
_last_job_progress_emit = {}
_job_progress_lock = threading.Lock()
_FFMPEG_TIME_RE = re.compile(r"time=(\d+):(\d+):(\d+\.?\d*)")
_FFMPEG_SPEED_RE = re.compile(r"speed=\s*([0-9.]+)x")


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
    user_error = format_processing_error(raw_error, max_workers=max_workers)
    payload = {"type": "error", "index": job_id, "error": user_error}
    if raw_error and raw_error != user_error:
        payload["raw_error"] = str(raw_error)[-1000:]
    _safe_print(json.dumps(payload))
    result = {"index": job_id, "status": "failed", "error": user_error}
    if raw_error and raw_error != user_error:
        result["raw_error"] = str(raw_error)
    return result


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
        if pct < 99.0 and (now - last_t) < 1.0:
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
    """Bounded stderr accumulator.

    Replaces the previous list+pop(0)+"".join() approach, which was O(n) per
    appended line (list shift and full-buffer join inside the stderr lock).
    Uses a deque(maxlen=...) for O(1) append/eviction and a running char count
    so the char-cap check is O(1) per line instead of O(total buffered chars).
    """

    __slots__ = ("_buf", "_chars", "_max_chars", "_total")

    def __init__(self, max_lines=MAX_STDERR_LINES, max_chars=MAX_STDERR_CHARS):
        self._buf = deque(maxlen=max_lines)
        self._chars = 0
        self._max_chars = max_chars
        self._total = 0

    def append(self, line):
        if len(self._buf) == self._buf.maxlen:
            self._chars -= len(self._buf[0])
        self._buf.append(line)
        self._chars += len(line)
        self._total += 1
        while self._chars > self._max_chars and len(self._buf) > 1:
            evicted = self._buf.popleft()
            self._chars -= len(evicted)

    def __len__(self):
        return len(self._buf)

    def total_appended(self):
        """Total lines ever appended (unbounded). Use this — not len() — to
        detect ongoing stderr activity, since len() is capped at max_lines."""
        return self._total

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
    if max_workers >= 3 and "timeout" in err.lower():
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
    text = str(stderr or "")
    if _is_transient_error(text):
        return True
    return "timeout" in text.lower()


def _kill_ffmpeg_process(proc):
    if proc.poll() is not None:
        return
    try:
        proc.kill()
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            pass


def _run_ffmpeg_stream(cmd, timeout_sec, job_id=None, duration_sec=0.0, *, ctx=None):
    """Run FFmpeg with bounded stderr capture, optional progress parsing, and cancel polling."""
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    stderr_lines = StderrBuffer()
    stderr_lock = threading.Lock()
    reader_done = threading.Event()
    progress_state = {"last_pct": -1.0}

    def read_stderr():
        try:
            if proc.stderr is None:
                return
            for line in proc.stderr:
                with stderr_lock:
                    stderr_lines.append(line)
                if job_id is None or duration_sec <= 0:
                    continue
                m = _FFMPEG_TIME_RE.search(line)
                if not m:
                    continue
                h, mi, sec = int(m.group(1)), int(m.group(2)), float(m.group(3))
                cur = h * 3600 + mi * 60 + sec
                pct = (cur / duration_sec) * 100.0
                sm = _FFMPEG_SPEED_RE.search(line)
                speed = float(sm.group(1)) if sm else None
                if pct - progress_state["last_pct"] >= 1.0 or pct >= 99.0:
                    _emit_job_progress(job_id, pct, speed, ctx=ctx)
                    progress_state["last_pct"] = pct
        finally:
            if proc.stderr is not None:
                proc.stderr.close()
            reader_done.set()

    threading.Thread(target=read_stderr, daemon=True).start()
    deadline = time.monotonic() + timeout_sec

    STALL_TIMEOUT_SEC = 120
    last_output_time = time.monotonic()
    prev_total = 0
    stall_enabled = job_id is not None and duration_sec > 0

    try:
        while True:
            returncode = proc.poll()
            if returncode is not None:
                break
            if _check_cancelled(ctx):
                _kill_ffmpeg_process(proc)
                reader_done.wait(timeout=1)
                _cleanup_ffmpeg_partial(cmd)
                return False, "Cancelled"
            now = time.monotonic()
            if now >= deadline:
                _kill_ffmpeg_process(proc)
                reader_done.wait(timeout=1)
                _cleanup_ffmpeg_partial(cmd)
                return False, f"Timeout after {timeout_sec}s"
            if stall_enabled:
                with stderr_lock:
                    current_total = stderr_lines.total_appended()
                if current_total > prev_total:
                    last_output_time = now
                    prev_total = current_total
                elif now - last_output_time > STALL_TIMEOUT_SEC:
                    _kill_ffmpeg_process(proc)
                    reader_done.wait(timeout=1)
                    _cleanup_ffmpeg_partial(cmd)
                    return False, f"FFmpeg stalled (no output for {STALL_TIMEOUT_SEC}s)"
            time.sleep(0.2)
    except Exception:
        if proc.poll() is None:
            _kill_ffmpeg_process(proc)
        reader_done.wait(timeout=1)
        raise

    reader_done.wait(timeout=2)
    with stderr_lock:
        stderr = stderr_lines.join()

    if returncode == 0:
        if job_id is not None and duration_sec > 0:
            _emit_job_progress(job_id, 100.0, None, ctx=ctx)
        return True, None
    return False, _extract_error_line(stderr)


def _run_ffmpeg(cmd, timeout_sec=600, job_id=None, duration_sec=0.0, *, ctx=None):
    """Run ffmpeg with retry for transient failures.

    The timeout scales with video duration when duration_sec is provided:
    at least 600s (10 min) or 3x the video duration, whichever is larger.
    This prevents false timeouts on long videos (4K, 1hr+) while keeping
    a reasonable bound for short clips.
    """
    if duration_sec > 0:
        timeout_sec = max(timeout_sec, int(duration_sec * 3))
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
    if ctx is None:
        time.sleep(delay)
        return
    deadline = time.monotonic() + delay
    while not _check_cancelled(ctx):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        ctx.cancel_event.wait(min(0.2, remaining))


def _native_stream_copy(input_path, output_path, *, ctx=None):
    """Chunked byte copy with cooperative cancellation. Returns (ok, err)."""
    try:
        with open(input_path, "rb") as fin, open(output_path, "wb") as fout:
            while True:
                if _check_cancelled(ctx):
                    return False, "Cancelled"
                chunk = fin.read(8 * 1024 * 1024)
                if not chunk:
                    return True, None
                fout.write(chunk)
    except OSError as exc:
        return False, str(exc)
