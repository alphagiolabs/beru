"""Job classifiers shared by the batch scheduler and per-job execution."""

from encode_profiles import profile_allows_hardware
from frame_geometry import is_identity_transform, normalize_transform
from clip_timing import playback_rate, repeat_count


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


def _job_processing_stages(job):
    """Resource policy considers each sequential composition stage independently."""
    if job.get("kind") != "composition":
        return [job]
    canvas = job.get("canvas") or {}
    return [*job.get("clips", []), {
        "kind": "canvas",
        "width": canvas.get("width", 0), "height": canvas.get("height", 0),
        "video_codec": "h264", "pix_fmt": "yuv420p",
        "encode_profile": job.get("encode_profile", "balanced"),
    }]


def _job_takes_copy_path(job):
    """True when _process_one takes the stream-copy path (no ops, watermark,
    trim, or geometry change). Schedulers use this to route I/O-bound jobs to the
    copy pool. Invalid trims fail inside _process_one before the copy branch, so
    parse errors classify as encode here."""
    if not isinstance(job, dict) or job.get("operations"):
        return False
    if job.get("kind") not in (None, "video"):
        return False
    if playback_rate(job) != 1 or repeat_count(job) != 1:
        return False
    watermark = job.get("watermark")
    if isinstance(watermark, dict) and watermark.get("enabled"):
        return False
    transform = normalize_transform(job)
    _, height = _job_dimensions(job)
    if height > 0 and transform["output_height"] is not None and transform["output_height"] >= height:
        transform = {**transform, "output_height": None}
    if not is_identity_transform(transform):
        return False
    try:
        trim_start, trim_end = _parse_trim_window(job)
    except (TypeError, ValueError):
        return False
    return trim_start <= 0 and trim_end is None


def _job_requires_encode(job):
    return isinstance(job, dict) and not _job_takes_copy_path(job)


def _jobs_require_fonts(jobs):
    for job in jobs:
        if not isinstance(job, dict):
            continue
        if job.get("kind") == "composition" and _jobs_require_fonts(job.get("clips", [])):
            return True
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
