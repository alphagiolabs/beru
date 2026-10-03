"""Pure operation normalization, geometry and timing helpers."""

import math
import os

def _env_flag(name, default, *, env=None):
    """Boolean env flag: unset -> default; '0/false/no/off' -> False."""
    raw = (os.environ if env is None else env).get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def _env_int(name, default=0, *, env=None):
    """Integer env var with a fallback for missing/unparseable values."""
    try:
        return int((os.environ if env is None else env).get(name) or default)
    except (TypeError, ValueError):
        return default

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


def _coerce_float(val, default, lo, hi):
    """Parse a float and clamp to [lo, hi]. Preserves 0 (never uses ``or``)."""
    if val is None:
        v = default
    else:
        try:
            v = float(val)
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

    method = out.get("delogo_method") or out.get("delogoMethod") or "blur"
    method = str(method).lower()
    out["delogo_method"] = method if method in VALID_DELOGO_METHODS else "blur"

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


def _region_looks_normalized(region, video_w, video_h):
    """True when a region is fractional (normalized) rather than pixel-sized.

    A 1x1 region is real pixels; only proper fractions (w < 1 or h < 1)
    are normalized.
    """
    if not region or video_w <= 0 or video_h <= 0:
        return False
    x = float(region.get("x", 0))
    y = float(region.get("y", 0))
    w = float(region.get("w", 0))
    h = float(region.get("h", 0))
    if w <= 0 or h <= 0:
        return False
    return (
        0 <= x <= 1
        and 0 <= y <= 1
        and 0 < w <= 1
        and 0 < h <= 1
        and (w < 1 or h < 1)
    )


def _region_to_pixels(region, video_w, video_h):
    """Convert a normalized (0..1) or pixel region to integer pixel coords.

    Electron denormalizes to pixels when dimensions are known, so a 1×1 box at
    the origin is a real 1px region — not a full-frame normalized unit square.
    Treat as normalized only when width or height is a proper fraction (< 1).
    """
    if not region:
        return None
    x = float(region.get("x", 0))
    y = float(region.get("y", 0))
    w = float(region.get("w", 0))
    h = float(region.get("h", 0))
    if w <= 0 or h <= 0:
        return None
    if _region_looks_normalized(region, video_w, video_h):
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


def _is_op_time_disabled(op):
    """Return True when the op has an explicit, empty time range (end <= start).

    A range like start=10, end=5 is invalid/empty. The user's intent is "don't
    apply this op" (or "apply only at a single instant" at best). Historically
    `_build_enable_clause` returned "" for this case, which callers treated as
    "no time filter" and applied the op for every t — silently producing output
    the user did not ask for. Centralising the empty-range check here lets
    `build_filter_complex` skip the op entirely, matching what the UI preview
    does (see isOpActive in src/utils/operation.js).
    """
    start = op.get("start_time", op.get("startTime"))
    end = op.get("end_time", op.get("endTime"))
    if start is None or end is None:
        return False
    try:
        return float(end) <= float(start)
    except (TypeError, ValueError):
        return False


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

    def _parse_finite(v):
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return f if math.isfinite(f) else None

    s = _parse_finite(start)
    e = _parse_finite(end)
    if s is not None and e is not None:
        if e <= s:
            return ""
        return f"enable=between(t\\,{s:.6f}\\,{e:.6f})"
    if s is not None:
        return f"enable=gte(t\\,{s:.6f})"
    if e is not None:
        return f"enable=lte(t\\,{e:.6f})"
    return ""


def _overlay_opts(x, y, enable_clause):
    opts = f"{x}:{y}"
    if enable_clause:
        opts += f":{enable_clause}"
    return opts
