"""Job classifiers shared by the batch scheduler and per-job execution."""

from encode_profiles import profile_allows_hardware


def _parse_trim_window(job):
    """Shared trim_start/trim_end parse; raises TypeError/ValueError."""
    start = float(job.get("trim_start") or 0)
    raw_end = job.get("trim_end")
    end = float(raw_end) if raw_end is not None else None
    return start, end


def _job_dimensions(job, info=None):
    """(width, height) from job metadata, falling back to probe info."""
    info = info or {}
    w = int(job.get("source_width") or job.get("width") or info.get("width") or 0)
    h = int(job.get("source_height") or job.get("height") or info.get("height") or 0)
    return w, h


def _job_takes_copy_path(job):
    """True when _process_one takes the stream-copy path (no ops, watermark,
    or trim). Schedulers use this to route I/O-bound jobs to the copy pool.
    Invalid trims fail inside _process_one before the copy branch, so parse
    errors classify as encode here."""
    if not isinstance(job, dict) or job.get("operations"):
        return False
    watermark = job.get("watermark")
    if isinstance(watermark, dict) and watermark.get("enabled"):
        return False
    try:
        trim_start, trim_end = _parse_trim_window(job)
    except (TypeError, ValueError):
        return False
    return trim_start <= 0 and trim_end is None


def _job_requires_encode(job):
    if not isinstance(job, dict):
        return False
    watermark = job.get("watermark")
    return bool(job.get("operations")) or (
        isinstance(watermark, dict) and bool(watermark.get("enabled"))
    )


def _jobs_require_fonts(jobs):
    for job in jobs:
        if not isinstance(job, dict):
            continue
        operations = job.get("operations", [])
        if any(op.get("mode") == "text" for op in operations if isinstance(op, dict)):
            return True
        watermark = job.get("watermark")
        if (
            isinstance(watermark, dict)
            and watermark.get("enabled")
            and watermark.get("type", "text") == "text"
        ):
            return True
    return False


def _jobs_allow_hardware(jobs):
    return any(
        _job_requires_encode(job)
        and profile_allows_hardware(job.get("encode_profile", "balanced"))
        for job in jobs
        if isinstance(job, dict)
    )
