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


def _clamp_delogo_rect(x, y, w, h, video_w, video_h):
    """Clamp a selected logo box without changing its visible frame edges."""
    if video_w <= 0 or video_h <= 0 or w <= 0 or h <= 0:
        return None
    x = max(0, min(int(x), video_w - 1))
    y = max(0, min(int(y), video_h - 1))
    w = max(1, min(int(w), video_w - x))
    h = max(1, min(int(h), video_h - y))
    return x, y, w, h


def _build_boxblur_filter(luma_radius, chroma_radius=None):
    """Build a boxblur whose radii stay valid for the runtime pixel format."""
    luma = max(0, int(luma_radius))
    chroma = luma if chroma_radius is None else max(0, int(chroma_radius))
    return (
        f"boxblur=luma_radius=min({luma}\\,min(w\\,h)/2):luma_power=1:"
        f"chroma_radius=min({chroma}\\,min(cw\\,ch)/2):chroma_power=1"
    )


def _fit_delogo_rect(x, y, w, h, video_w, video_h):
    """Clamp a native ``delogo`` box while preserving valid odd dimensions.

    The caller handles frame-edge selections with blur because native delogo
    needs pixels immediately outside the box for interpolation.
    """
    rect = _clamp_delogo_rect(x, y, w, h, video_w, video_h)
    if rect is None:
        return 0, 0, 0, 0
    return rect


def _seamless_feather_widths(feather, left, top, right, bottom):
    """Clamp each alpha ramp to the context available on that frame side."""
    f = max(0, int(feather or 0))
    return tuple(max(0, min(f, int(side))) for side in (left, top, right, bottom))


def _seamless_box_alpha_filter(left, top, w, h, feather_widths):
    """Alpha for a padded patch: fully opaque over the logo box at
    ``(left, top, w, h)`` (crop-local coords), linear ramp to transparent
    across ``f`` pixels of surrounding context.

    Blending toward the original frame is only correct OUTSIDE the logo box:
    inside, the frame still shows the logo, so the box itself must stay
    opaque. Commas live inside single quotes so the filtergraph parser
    treats them as literal (per ffmpeg docs).
    """
    left_f, top_f, right_f, bottom_f = feather_widths
    right_edge = left + w - 1
    bottom_edge = top + h - 1
    ramps = []
    if left_f:
        ramps.append(f"(X-({left - left_f}))/{left_f}")
    if top_f:
        ramps.append(f"(Y-({top - top_f}))/{top_f}")
    if right_f:
        ramps.append(f"({right_edge + right_f}-X)/{right_f}")
    if bottom_f:
        ramps.append(f"({bottom_edge + bottom_f}-Y)/{bottom_f}")
    opacity = "1"
    for ramp in ramps:
        opacity = f"min({opacity},{ramp})"
    expr = f"255*max({opacity},0)"
    return f"format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{expr}'"


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
        return f"tmedian=radius={radius}:planes=0x7"

    if method == "mosaic":
        block = _coerce_int(op.get("mosaic_size"), 12, 4, 80)
        # Tiny patches (< 1 block) would evaluate scale to 0 and fail; clamp to 1.
        return (
            f"scale=max(1\\,iw/{block}):max(1\\,ih/{block}):flags=neighbor,"
            f"scale={rw}:{rh}:flags=neighbor"
        )

    if method == "blur":
        strength = _coerce_int(op.get("blur_strength"), 20, 1, 100)
        luma = max(1, min(100, strength // 3))
        chroma = max(1, luma // 2)
        return _build_boxblur_filter(luma, chroma)

    if method == "fill":
        fill_color = _validate_drawtext_color(
            op.get("delogo_fill_color") or "black", "delogo_fill_color"
        )
        fill_opacity = _coerce_float(op.get("delogo_fill_opacity"), 1.0, 0.0, 1.0)
        return (
            f"drawbox=x=0:y=0:w={rw}:h={rh}:color={fill_color}@{fill_opacity}:t=fill"
        )

    return _build_boxblur_filter(10, 5)


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


def _seamless_overlay_tail(clean_label, s, idx, x0, y0, rw, rh, box, feather, enable_clause):
    """Composite a cleaned patch with an alpha-feathered seam.

    ``box`` is the (left, top, w, h) logo box in crop-local coords. The box
    stays fully opaque (the frame still shows the logo there); only the
    surrounding context cross-fades, so pixels outside the patch are never
    touched (no halo) and no logo pixels leak back in. Falls back to a hard
    overlay when no ramp fits.
    """
    left, top, w, h = box
    feather_widths = _seamless_feather_widths(
        feather, left, top, rw - (left + w), rh - (top + h)
    )
    if not any(feather_widths):
        return f"[full{s}][{clean_label}]overlay={_overlay_opts(x0, y0, enable_clause)}[tmp{idx}]"
    return (
        f"[{clean_label}]{_seamless_box_alpha_filter(left, top, w, h, feather_widths)}[soft{s}];"
        f"[full{s}][soft{s}]overlay={_overlay_opts(x0, y0, enable_clause)}[tmp{idx}]"
    )


def _inpaint_filter_graph(src, s, idx, x, y, w, h, x0, y0, rw, rh, feather, enable_clause):
    delogo = f"delogo=x={x}:y={y}:w={w}:h={h}"
    if feather <= 0 and not enable_clause:
        return f"{src}{delogo}[tmp{idx}]"
    if feather <= 0:
        # feather=0 with time bounds: FFmpeg boxblur treats 0 as 1.
        return (
            f"{src}split[full{s}][work{s}];"
            f"[work{s}]{delogo}[work_clean{s}];"
            f"[work_clean{s}]crop={rw}:{rh}:{x0}:{y0}[crop{s}];"
            f"[full{s}][crop{s}]overlay={_overlay_opts(x0, y0, enable_clause)}[tmp{idx}]"
        )
    # Interior treatment (unchanged): soften delogo interpolation streaks,
    # then grain-match so the patch does not read as flat plastic against
    # compressed-video grain. The box-aware alpha seam (tail) confines all of
    # this to the patch — no halo beyond it.
    feather_blur = max(1, feather)
    head = (
        f"{src}split[full{s}][work{s}];"
        f"[work{s}]{delogo}[work_clean{s}];"
        f"[work_clean{s}]crop={rw}:{rh}:{x0}:{y0}[crop{s}];"
        f"[crop{s}]{_build_boxblur_filter(feather_blur)},noise=alls=4:allf=t[clean{s}];"
    )
    return head + _seamless_overlay_tail(
        f"clean{s}", s, idx, x0, y0, rw, rh, (x - x0, y - y0, w, h),
        feather, enable_clause,
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

    method = (op.get("delogo_method") or "blur").lower()
    if method not in VALID_DELOGO_METHODS:
        method = "blur"
    rect = _clamp_delogo_rect(x, y, w, h, video_w, video_h)
    if rect is None:
        return None
    x, y, w, h = rect
    feather = _coerce_int(op.get("edge_feather"), 6, 0, 40)
    pad = max(2, feather)
    padded = _build_padded_region(x, y, w, h, video_w, video_h, pad)
    if padded is None:
        return None
    x0, y0, rw, rh = padded

    enable_clause = _build_enable_clause(op)
    src = "[0:v]" if prev_label is None else f"[{prev_label}]"
    s = f"d{idx}"

    if method == "inpaint":
        touches_frame = x == 0 or y == 0 or x + w == video_w or y + h == video_h
        if touches_frame:
            return _build_delogo_chain(
                {
                    **op,
                    "region": {"x": x, "y": y, "w": w, "h": h},
                    "delogo_method": "blur",
                },
                prev_label,
                idx,
                video_w,
                video_h,
                img_input_index,
            )
        x, y, w, h = _fit_delogo_rect(x, y, w, h, video_w, video_h)
        x0, y0, rw, rh = _build_padded_region(
            x, y, w, h, video_w, video_h, max(2, feather)
        )
        return _inpaint_filter_graph(
            src, s, idx, x, y, w, h, x0, y0, rw, rh, feather, enable_clause
        )

    if method == "mirror":
        mirror_side = op.get("mirror_side") or "right"
        mirror_chain = _build_mirror_patch(
            mirror_side, x, y, w, h, video_w, video_h, f"work{s}", f"clean{s}"
        )
        if mirror_chain is None:
            return _build_delogo_chain(
                {
                    **op,
                    "region": {"x": x, "y": y, "w": w, "h": h},
                    "delogo_method": "blur",
                },
                prev_label,
                idx,
                video_w,
                video_h,
                img_input_index,
            )
        if feather <= 0:
            return (
                f"{src}split[full{s}][work{s}];"
                f"{mirror_chain};"
                f"[full{s}][clean{s}]overlay={_overlay_opts(x, y, enable_clause)}[tmp{idx}]"
            )
        # Widen the mirrored patch into the surroundings so the seam ramp
        # blends mirrored context with original context (both logo-free)
        # instead of leaking logo pixels back along the box edge. The box
        # itself stays fully opaque. If there is no room to widen, the tail
        # degrades to a hard overlay of the exact mirrored box.
        exp = max(1, int(feather))
        mx, my = max(0, x - exp), max(0, y - exp)
        mw = min(w + 2 * exp, video_w - mx)
        mh = min(h + 2 * exp, video_h - my)
        wide_chain = _build_mirror_patch(
            mirror_side, mx, my, mw, mh, video_w, video_h, f"work{s}", f"clean{s}"
        )
        if wide_chain is not None:
            mirror_chain = wide_chain
            head = (
                f"{src}split[full{s}][work{s}];"
                f"{mirror_chain};"
            )
            return head + _seamless_overlay_tail(
                f"clean{s}", s, idx, mx, my, mw, mh, (x - mx, y - my, w, h),
                feather, enable_clause,
            )
        return _build_delogo_chain(
            {
                **op,
                "region": {"x": x, "y": y, "w": w, "h": h},
                "delogo_method": "blur",
            },
            prev_label,
            idx,
            video_w,
            video_h,
            img_input_index,
        )

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
            f"format=rgba,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black@0[cover{s}];"
            f"{src}[cover{s}]overlay={overlay_opts}[tmp{idx}]"
        )

    cleanup = _build_cleanup_filter(method, op, rw, rh)

    if feather <= 0:
        return (
            f"{src}split[full{s}][work{s}];"
            f"[work{s}]crop={w}:{h}:{x}:{y}[crop{s}];"
            f"[crop{s}]{cleanup}[clean{s}];"
            f"[full{s}][clean{s}]overlay={_overlay_opts(x, y, enable_clause)}[tmp{idx}]"
        )

    head = (
        f"{src}split[full{s}][work{s}];"
        f"[work{s}]crop={rw}:{rh}:{x0}:{y0}[crop{s}];"
        f"[crop{s}]{cleanup}[clean{s}];"
    )
    return head + _seamless_overlay_tail(
        f"clean{s}", s, idx, x0, y0, rw, rh, (x - x0, y - y0, w, h),
        feather, enable_clause,
    )
