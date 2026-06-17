"""Shared, pure operation helpers for processor.py.

Extracted from the ``processor.py`` monolith.  These helpers are stateless
and never monkeypatched by the test suite, so they are safe to live outside
``processor.py``'s single namespace.  ``processor.py`` re-exports the public
ones (``_normalize_operation``, ``_region_to_pixels``) for backwards
compatibility with the Python smoke tests.

Logger is fetched lazily via ``logging.getLogger("beru")`` so this module does
not import ``processor`` (which would be circular) but still emits through the
same configured logger once ``processor.py`` has run ``setup_logging``.
"""

import logging

logger = logging.getLogger("beru")

VALID_DELOGO_METHODS = frozenset({
    "temporal", "mirror", "mosaic", "inpaint", "blur", "fill", "cover",
})


def _coerce_int(val, default, lo, hi):
    if val is None:
        v = default
    else:
        try:
            v = int(val)
        except (TypeError, ValueError):
            v = default
    return max(lo, min(hi, v))


def _normalize_operation(op):
    """Accept snake_case or camelCase keys from jobs / hand-edited JSON."""
    if not isinstance(op, dict):
        return op
    out = dict(op)
    mode = (out.get("mode") or "").lower()
    if mode != "delogo":
        return out

    method = out.get("delogo_method") or out.get("delogoMethod") or "temporal"
    method = str(method).lower()
    out["delogo_method"] = method if method in VALID_DELOGO_METHODS else "temporal"

    pairs = (
        ("temporal_radius", "temporalRadius"),
        ("mosaic_size", "mosaicSize"),
        ("mirror_side", "mirrorSide"),
        ("edge_feather", "edgeFeather"),
        ("blur_strength", "blurStrength"),
        ("delogo_fill_color", "delogoFillColor"),
        ("delogo_fill_opacity", "delogoFillOpacity"),
        ("delogo_image_path", "delogoImagePath"),
        ("start_time", "startTime"),
        ("end_time", "endTime"),
    )
    for snake, camel in pairs:
        if out.get(snake) is None and camel in out:
            out[snake] = out[camel]

    return out


def _optimize_delogo_for_speed(op, video_w, video_h):
    """Use inpaint instead of tmedian for full-duration static logos (much faster)."""
    if (op.get("mode") or "").lower() != "delogo":
        return op
    method = (op.get("delogo_method") or "temporal").lower()
    if method != "temporal":
        return op

    start = op.get("start_time", op.get("startTime"))
    end = op.get("end_time", op.get("endTime"))
    if start is not None or end is not None:
        return op

    radius = op.get("temporal_radius")
    if radius is not None:
        try:
            if int(radius) != 3:
                return op
        except (TypeError, ValueError):
            pass

    region = op.get("region") or {}
    rw = float(region.get("w", 0))
    rh = float(region.get("h", 0))
    if rw <= 0 or rh <= 0:
        return op

    if video_w > 0 and video_h > 0 and rw <= 1 and rh <= 1:
        area_ratio = rw * rh
    elif video_w > 0 and video_h > 0:
        area_ratio = (rw * rh) / (video_w * video_h)
    else:
        area_ratio = 0.1

    if area_ratio > 0.25:
        return op

    optimized = dict(op)
    optimized["delogo_method"] = "inpaint"
    logger.debug(
        "delogo: temporal -> inpaint (%.1f%% frame, faster static path)", area_ratio * 100
    )
    return optimized


def _region_to_pixels(region, video_w, video_h):
    """Convert a normalized (0..1) or pixel region to integer pixel coords."""
    if not region:
        return None
    x = float(region.get("x", 0))
    y = float(region.get("y", 0))
    w = float(region.get("w", 0))
    h = float(region.get("h", 0))
    if w <= 0 or h <= 0:
        return None
    if video_w > 0 and video_h > 0 and x <= 1 and y <= 1 and w <= 1 and h <= 1:
        px = max(0, int(round(x * video_w)))
        py = max(0, int(round(y * video_h)))
        pw = max(1, min(video_w - px, int(round(w * video_w))))
        ph = max(1, min(video_h - py, int(round(h * video_h))))
        return {"x": px, "y": py, "w": pw, "h": ph}
    px = max(0, int(round(x)))
    py = max(0, int(round(y)))
    pw = max(1, min(video_w - px, int(round(w)))) if video_w > 0 else max(1, int(round(w)))
    ph = max(1, min(video_h - py, int(round(h)))) if video_h > 0 else max(1, int(round(h)))
    return {"x": px, "y": py, "w": pw, "h": ph}


def _build_enable_clause(op):
    """Build an `enable=...` clause for time-bounding filters.

    Returns "" if no time range, else a clause like:
        enable=between(t\\,0.500000\\,2.000000)
    Note: literal commas are escaped (\\,) so they don't split filter options.
    """
    start = op.get("start_time", op.get("startTime"))
    end = op.get("end_time", op.get("endTime"))
    if start is None and end is None:
        return ""
    s = float(start) if start is not None else 0.0
    e = float(end) if end is not None else 0.0
    if e <= s:
        return ""
    return f"enable=between(t\\,{s:.6f}\\,{e:.6f})"


def _overlay_opts(x, y, enable_clause):
    opts = f"{x}:{y}"
    if enable_clause:
        opts += f":{enable_clause}"
    return opts
