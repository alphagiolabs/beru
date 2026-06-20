"""Delogo filter-chain builders for processor.py.

Extracted from the ``processor.py`` monolith.  These are pure graph builders
(not monkeypatched by the test suite) that import the shared operation helpers
from ``op_shared``.  ``processor.py`` calls ``_build_delogo_chain`` from
``build_filter_complex``.

Logger is fetched lazily via ``logging.getLogger("beru")`` to avoid a circular
import with ``processor`` (which configures the "beru" logger at import time).
"""

import logging
import os

from color_validation import _validate_drawtext_color
from op_shared import (
    VALID_DELOGO_METHODS,
    _build_enable_clause,
    _coerce_float,
    _coerce_int,
    _overlay_opts,
)

logger = logging.getLogger("beru")


def _fit_delogo_rect(x, y, w, h, video_w, video_h):
    """Clamp logo box to frame; FFmpeg delogo prefers even width/height."""
    x = max(0, min(int(x), max(0, video_w - 2)))
    y = max(0, min(int(y), max(0, video_h - 2)))
    w = max(2, min(int(w), video_w - x))
    h = max(2, min(int(h), video_h - y))
    if w % 2:
        w -= 1
    if h % 2:
        h -= 1
    if w < 2:
        w = 2
    if h < 2:
        h = 2
    if x + w > video_w:
        x = max(0, video_w - w)
    if y + h > video_h:
        y = max(0, video_h - h)
    return x, y, w, h


def _build_padded_region(x, y, w, h, video_w, video_h, pad):
    """Return (x0, y0, rw, rh) for a feather/context pad around the logo box."""
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(video_w, x + w + pad)
    y1 = min(video_h, y + h + pad)
    rw = x1 - x0
    rh = y1 - y0
    if rw <= 0 or rh <= 0:
        return None
    return x0, y0, rw, rh


def _build_cleanup_filter(method, op, rw, rh):
    """Single-input cleanup filters for a cropped patch (rw x rh).

    Mirror and inpaint are handled separately on the full frame.
    """
    if method == "temporal":
        radius = _coerce_int(op.get("temporal_radius"), 3, 1, 15)
        # Median across neighboring frames removes static logos on motion.
        return f"tmedian=radius={radius}:planes=0x7"

    if method == "mosaic":
        block = _coerce_int(op.get("mosaic_size"), 12, 4, 80)
        return (
            f"scale=iw/{block}:ih/{block}:flags=neighbor,"
            f"scale={rw}:{rh}:flags=neighbor"
        )

    if method == "blur":
        strength = _coerce_int(op.get("blur_strength"), 20, 1, 100)
        luma = max(1, min(100, strength // 3))
        chroma = max(1, luma // 2)
        return f"boxblur=luma_radius={luma}:luma_power=1:chroma_radius={chroma}:chroma_power=1"

    if method == "fill":
        fill_color = _validate_drawtext_color(
            op.get("delogo_fill_color") or "black", "delogo_fill_color"
        )
        fill_opacity = _coerce_float(op.get("delogo_fill_opacity"), 1.0, 0.0, 1.0)
        return (
            f"drawbox=x=0:y=0:w={rw}:h={rh}:color={fill_color}@{fill_opacity}:t=fill"
        )

    # inpaint / mirror use dedicated paths; fallback = edge blend
    return "boxblur=luma_radius=10:luma_power=1:chroma_radius=5:chroma_power=1"


def _build_mirror_patch(side, x, y, w, h, video_w, video_h, in_label, out_label):
    """Sample pixels adjacent to the logo box and mirror them into the patch.

    Matches the live-preview logic: reflect the strip beside the selection
    over the logo area (same approach as online logo removers on uniform bg).
    """
    side = (side or "right").lower()
    in_pad = f"[{in_label}]"
    out_pad = f"[{out_label}]"

    if side == "right":
        if x + w + w <= video_w:
            return f"{in_pad}crop={w}:{h}:{x + w}:{y},hflip{out_pad}"
        if x >= w:
            return f"{in_pad}crop={w}:{h}:{x - w}:{y},hflip{out_pad}"
    elif side == "left":
        if x >= w:
            return f"{in_pad}crop={w}:{h}:{x - w}:{y},hflip{out_pad}"
        if x + w + w <= video_w:
            return f"{in_pad}crop={w}:{h}:{x + w}:{y},hflip{out_pad}"
    elif side == "bottom":
        if y + h + h <= video_h:
            return f"{in_pad}crop={w}:{h}:{x}:{y + h},vflip{out_pad}"
        if y >= h:
            return f"{in_pad}crop={w}:{h}:{x}:{y - h},vflip{out_pad}"
    elif side == "top":
        if y >= h:
            return f"{in_pad}crop={w}:{h}:{x}:{y - h},vflip{out_pad}"
        if y + h + h <= video_h:
            return f"{in_pad}crop={w}:{h}:{x}:{y + h},vflip{out_pad}"

    # Partial strip at frame edge: use whatever context exists, then scale.
    # When there is no context on the requested side (logo flush at the edge),
    # fall back to None so the caller drops the op or uses inpaint instead of
    # sampling an out-of-frame crop.
    if side in ("left", "right"):
        avail = video_w - (x + w) if side == "right" else x
        if avail <= 0:
            return None
        src_x = x + w if side == "right" else max(0, x - avail)
        cw = max(1, min(w, avail))
        return (
            f"{in_pad}crop={cw}:{h}:{src_x}:{y},hflip,"
            f"scale={w}:{h}:flags=bilinear{out_pad}"
        )
    avail = video_h - (y + h) if side == "bottom" else y
    if avail <= 0:
        return None
    src_y = y + h if side == "bottom" else max(0, y - avail)
    ch = max(1, min(h, avail))
    return (
        f"{in_pad}crop={w}:{ch}:{x}:{src_y},vflip,"
        f"scale={w}:{h}:flags=bilinear{out_pad}"
    )


def _build_delogo_chain(op, prev_label, idx, video_w, video_h, img_input_index=None):
    """Build delogo filter chain (split → clean → overlay).

    - temporal / mosaic / blur / fill: clean the (optionally padded) crop.
    - inpaint: FFmpeg delogo on full frame (interpolates from edges).
    - mirror: reflect adjacent pixels into the logo box (uniform backgrounds).
    - cover: overlay a user image scaled/padded to the logo box.
    """
    region = op.get("region") or {}
    x = int(region.get("x", 0))
    y = int(region.get("y", 0))
    w = int(region.get("w", video_w))
    h = int(region.get("h", video_h))
    if w <= 0 or h <= 0:
        return None

    x, y, w, h = _fit_delogo_rect(x, y, w, h, video_w, video_h)

    method = (op.get("delogo_method") or "temporal").lower()
    if method not in VALID_DELOGO_METHODS:
        method = "temporal"
    feather = _coerce_int(op.get("edge_feather"), 6, 0, 40)
    pad = max(2, feather)
    padded = _build_padded_region(x, y, w, h, video_w, video_h, pad)
    if padded is None:
        return None
    x0, y0, rw, rh = padded

    enable_clause = _build_enable_clause(op)
    src = "[0:v]" if prev_label is None else f"[{prev_label}]"
    s = f"d{idx}"
    feather_blur = max(1, feather)

    # ── Inpaint: native delogo on full frame (best for watermark boxes) ──
    if method == "inpaint":
        delogo = f"delogo=x={x}:y={y}:w={w}:h={h}"
        if feather <= 0 and not enable_clause:
            return f"{src}{delogo}[tmp{idx}]"
        return (
            f"{src}split[full{s}][work{s}];"
            f"[work{s}]{delogo}[work_clean{s}];"
            f"[work_clean{s}]crop={rw}:{rh}:{x0}:{y0}[crop{s}];"
            f"[crop{s}]boxblur={feather_blur}[soft{s}];"
            f"[full{s}][soft{s}]overlay={_overlay_opts(x0, y0, enable_clause)}[tmp{idx}]"
        )

    # ── Mirror: sample from outside the logo, overlay at logo coords ──
    if method == "mirror":
        mirror_side = op.get("mirror_side") or "right"
        mirror_chain = _build_mirror_patch(
            mirror_side, x, y, w, h, video_w, video_h, f"work{s}", f"clean{s}"
        )
        # No context on the requested side (logo flush at frame edge): fall
        # back to inpaint so FFmpeg still produces a valid output.
        if mirror_chain is None:
            delogo = f"delogo=x={x}:y={y}:w={w}:h={h}"
            if feather <= 0 and not enable_clause:
                return f"{src}{delogo}[tmp{idx}]"
            return (
                f"{src}split[full{s}][work{s}];"
                f"[work{s}]{delogo}[work_clean{s}];"
                f"[work_clean{s}]crop={rw}:{rh}:{x0}:{y0}[crop{s}];"
                f"[crop{s}]boxblur={feather_blur}[soft{s}];"
                f"[full{s}][soft{s}]overlay={_overlay_opts(x0, y0, enable_clause)}[tmp{idx}]"
            )
        if feather <= 0:
            return (
                f"{src}split[full{s}][work{s}];"
                f"{mirror_chain};"
                f"[full{s}][clean{s}]overlay={_overlay_opts(x, y, enable_clause)}[tmp{idx}]"
            )
        return (
            f"{src}split[full{s}][work{s}];"
            f"{mirror_chain};"
            f"[clean{s}]boxblur={feather_blur}[soft{s}];"
            f"[full{s}][soft{s}]overlay={_overlay_opts(x, y, enable_clause)}[tmp{idx}]"
        )

    # ── Cover: user image scaled and padded to the logo box, overlaid at logo coords ──
    if method == "cover":
        img_path = op.get("delogo_image_path")
        if not img_path or not os.path.exists(img_path):
            logger.warning("Cover delogo skipped: file not found: %s", img_path)
            return None
        if img_input_index is None:
            logger.warning("Cover delogo skipped: img_input_index not available")
            return None
        input_idx = img_input_index(img_path)
        overlay_opts = _overlay_opts(x, y, enable_clause)
        return (
            f"[{input_idx}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,format=rgba[cover{s}];"
            f"{src}[cover{s}]overlay={overlay_opts}[tmp{idx}]"
        )

    # ── Patch methods: crop → clean → (feather) → overlay ──
    cleanup = _build_cleanup_filter(method, op, rw, rh)

    if feather <= 0:
        return (
            f"{src}split[full{s}][work{s}];"
            f"[work{s}]crop={w}:{h}:{x}:{y}[crop{s}];"
            f"[crop{s}]{cleanup}[clean{s}];"
            f"[full{s}][clean{s}]overlay={_overlay_opts(x, y, enable_clause)}[tmp{idx}]"
        )

    return (
        f"{src}split[full{s}][work{s}];"
        f"[work{s}]crop={rw}:{rh}:{x0}:{y0}[crop{s}];"
        f"[crop{s}]{cleanup}[clean{s}];"
        f"[clean{s}]boxblur={feather_blur}[soft{s}];"
        f"[full{s}][soft{s}]overlay={_overlay_opts(x0, y0, enable_clause)}[tmp{idx}]"
    )
