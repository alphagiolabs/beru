"""Delogo filter-chain builders using shared operation helpers."""

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
_DELOGO_SOURCE_FORMATS = frozenset({
    "yuv420p", "yuv422p", "yuv444p", "yuvj420p", "yuvj422p", "yuvj444p",
    "yuv420p10le", "yuv422p10le", "yuv444p10le",
})


def _delogo_overlay_opts(x, y, enable_clause, pixel_format=None):
    formats = {"yuv422p": "yuv422", "yuvj422p": "yuv422",
               "yuv444p": "yuv444", "yuvj444p": "yuv444",
               "yuv420p10le": "yuv420p10", "yuv422p10le": "yuv422p10",
               "yuv444p10le": "yuv444p10"}
    output_format = formats.get(pixel_format, "yuv420")
    return _overlay_opts(x, y, enable_clause) + f":format={output_format}:alpha=straight"


def _clamp_delogo_rect(x, y, w, h, video_w, video_h):
    """Clamp a selected logo box without changing its visible frame edges."""
    if video_w <= 0 or video_h <= 0 or w <= 0 or h <= 0:
        return None
    left = max(0, int(x))
    top = max(0, int(y))
    right = min(video_w, int(x) + int(w))
    bottom = min(video_h, int(y) + int(h))
    if right <= left or bottom <= top:
        return None
    return left, top, right - left, bottom - top


def _build_boxblur_filter(luma_radius, chroma_radius=None, power=1):
    """Build a boxblur whose radii stay valid for the runtime pixel format.

    ``power`` counts blur passes; 3 passes approximate the gaussian the live
    canvas preview draws (sigma ~= radius), so exports match the preview.
    """
    luma = max(0, int(luma_radius))
    chroma = luma if chroma_radius is None else max(0, int(chroma_radius))
    return (
        f"boxblur=luma_radius=min({luma}\\,floor((min(w\\,h)-1)/2)):luma_power={int(power)}:"
        f"chroma_radius=min({chroma}\\,floor((min(cw\\,ch)-1)/2)):chroma_power={int(power)}"
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


def _with_enable(filter_str, enable_clause):
    return f"{filter_str}:{enable_clause}" if enable_clause else filter_str


def _seamless_opacity_expr(left, top, w, h, feather_widths):
    """Opaque logo core with smoothstep ramps only in logo-free context."""
    left_f, top_f, right_f, bottom_f = feather_widths
    right_edge = left + w - 1
    bottom_edge = top + h - 1
    ramps = []
    ramps.append(f"(X-({left - left_f}))/{left_f}" if left_f else f"gte(X,{left})")
    ramps.append(f"(Y-({top - top_f}))/{top_f}" if top_f else f"gte(Y,{top})")
    ramps.append(f"({right_edge + right_f}-X)/{right_f}" if right_f else f"lte(X,{right_edge})")
    ramps.append(f"({bottom_edge + bottom_f}-Y)/{bottom_f}" if bottom_f else f"lte(Y,{bottom_edge})")
    opacity = "1"
    for ramp in ramps:
        opacity = f"min({opacity},{ramp})"
    opacity = f"clip({opacity},0,1)"
    return f"({opacity})*({opacity})*(3-2*({opacity}))"


def _build_padded_region(x, y, w, h, video_w, video_h, pad, *, aligned=False):
    """Return (x0, y0, rw, rh) for a feather/context pad around the logo box."""
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(video_w, x + w + pad)
    y1 = min(video_h, y + h + pad)
    if aligned:
        # Preserve the chroma grid without moving odd selections on YUV420.
        x0 -= x0 % 2
        y0 -= y0 % 2
        x1 = min(video_w, x1 + x1 % 2)
        y1 = min(video_h, y1 + y1 % 2)
    rw = x1 - x0
    rh = y1 - y0
    if rw <= 0 or rh <= 0:
        return None
    return x0, y0, rw, rh


def _build_cleanup_filter(method, op, rw, rh, enable_clause=""):
    """Single-input cleanup filters for a cropped patch (rw x rh).

    Mirror and inpaint have dedicated context builders.
    """
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
        return _with_enable(_build_boxblur_filter(luma, chroma, power=3), enable_clause)

    if method == "fill":
        fill_color = _validate_drawtext_color(
            op.get("delogo_fill_color") or "black", "delogo_fill_color"
        )
        fill_opacity = _coerce_float(op.get("delogo_fill_opacity"), 1.0, 0.0, 1.0)
        return _with_enable(
            f"drawbox=x=0:y=0:w={rw}:h={rh}:color={fill_color}@{fill_opacity}:t=fill",
            enable_clause,
        )

    return _with_enable(_build_boxblur_filter(10, 5), enable_clause)


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


def _seamless_overlay_tail(clean_label, s, idx, x0, y0, rw, rh, box, feather, enable_clause,
                           pixel_format=None):
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
    if not any(feather_widths) and box == (0, 0, rw, rh):
        return f"[full{s}][{clean_label}]overlay={_delogo_overlay_opts(x0, y0, enable_clause, pixel_format)}[tmp{idx}]"
    opacity = _seamless_opacity_expr(left, top, w, h, feather_widths)
    if pixel_format is None or "10" not in pixel_format:
        alpha_format = {
            "yuv422p": "yuva422p", "yuvj422p": "yuva422p",
            "yuv444p": "yuva444p", "yuvj444p": "yuva444p",
        }.get(pixel_format, "yuva420p")
        mask = (
            f"select='eq(n\\,0)',format=gray,geq=lum='255*({opacity})',"
            "loop=loop=-1:size=1,setpts=N/TB"
        )
        return (
            f"[{clean_label}]format={pixel_format or 'yuv420p'},split[cmrg{s}][msrc{s}];"
            f"[msrc{s}]{mask}[mask{s}];"
            f"[cmrg{s}]format={alpha_format}[color{s}];"
            f"[color{s}][mask{s}]alphamerge=shortest=1[soft{s}];"
            f"[full{s}][soft{s}]overlay={_delogo_overlay_opts(x0, y0, enable_clause, pixel_format)}[tmp{idx}]"
        )
    # alphamerge accepts only 8-bit inputs; blend retains native precision.
    # SW/SH map chroma-plane coordinates to luma-pixel mask coordinates.
    opacity = opacity.replace("X", "(X/SW)").replace("Y", "(Y/SH)")
    clean_format = f"[{clean_label}]format={pixel_format}[precision{s}];"
    clean_label = f"precision{s}"
    return (
        clean_format +
        f"[full{s}]split[base{s}][original{s}];"
        f"[original{s}]crop={rw}:{rh}:{x0}:{y0}[context{s}];"
        f"[{clean_label}][context{s}]blend=all_expr='B+(A-B)*({opacity})'[soft{s}];"
        f"[base{s}][soft{s}]overlay={_delogo_overlay_opts(x0, y0, enable_clause, pixel_format)}[tmp{idx}]"
    )


def _delogo_reconstruction_filter(x, y, w, h, width, height, guard=0):
    left, top = max(1, x - guard), max(1, y - guard)
    right, bottom = min(width - 1, x + w + guard), min(height - 1, y + h + guard)
    return f"delogo=x={left}:y={top}:w={right-left}:h={bottom-top}"


def _inpaint_filter_graph(src, s, idx, x, y, w, h, x0, y0, rw, rh, feather, enable_clause,
                          pixel_format=None, reference_guard=0):
    delogo = f"delogo=x={x}:y={y}:w={w}:h={h}"
    if feather <= 0 and not enable_clause and not pixel_format and not reference_guard:
        return f"{src}{_with_enable(delogo, enable_clause)}[tmp{idx}]"
    patch_delogo = _with_enable(
        _delogo_reconstruction_filter(x-x0, y-y0, w, h, rw, rh, reference_guard), enable_clause
    )
    work_format = (pixel_format or "yuv420p").replace("10le", "")
    work = f"[work{s}]crop={rw}:{rh}:{x0}:{y0},format={work_format},{patch_delogo}[crop{s}];"
    if feather <= 0:
        return (
            f"{src}split[full{s}][work{s}];"
            f"{work}"
        ) + _seamless_overlay_tail(
            f"crop{s}", s, idx, x0, y0, rw, rh, (x - x0, y - y0, w, h),
            0, enable_clause, pixel_format,
        )
    head = (
        f"{src}split[full{s}][work{s}];"
        f"{work}"
        f"[crop{s}]{_with_enable(_build_boxblur_filter(2, 1), enable_clause)}[clean{s}];"
    )
    return head + _seamless_overlay_tail(
        f"clean{s}", s, idx, x0, y0, rw, rh, (x - x0, y - y0, w, h),
        feather, enable_clause, pixel_format,
    )


def _blur_filter_graph(src, s, idx, op, x, y, w, h, video_w, video_h, feather, enable_clause,
                       pixel_format=None):
    strength = _coerce_int(op.get("blur_strength"), 20, 1, 100)
    radius = max(1, strength // 3)
    x0, y0, rw, rh = _build_padded_region(
        x, y, w, h, video_w, video_h, feather, aligned=True
    )
    bx, by, bw, bh = _build_padded_region(
        x0, y0, rw, rh, video_w, video_h, 3 * radius, aligned=True
    )
    cleanup = _build_cleanup_filter("blur", op, bw, bh, enable_clause)
    head = (
        f"{src}split[full{s}][work{s}];"
        f"[work{s}]crop={bw}:{bh}:{bx}:{by},format={pixel_format or 'yuv420p'},{cleanup},"
        f"crop={rw}:{rh}:{x0 - bx}:{y0 - by}[clean{s}];"
    )
    return head + _seamless_overlay_tail(
        f"clean{s}", s, idx, x0, y0, rw, rh, (x - x0, y - y0, w, h),
        feather, enable_clause, pixel_format,
    )


def _build_delogo_chain(op, prev_label, idx, video_w, video_h, img_input_index=None,
                         source_pix_fmt=None, *, temporal_patch=None):
    """Build delogo filter chain (split → clean → overlay).

    - temporal: composite a compensated patch, or use spatial reconstruction.
    - mosaic / blur / fill: clean the (optionally padded) crop.
    - inpaint: FFmpeg delogo on aligned context (interpolates from edges).
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

    enable_clause = _build_enable_clause(op)
    if source_pix_fmt not in _DELOGO_SOURCE_FORMATS:
        source_pix_fmt = None
    src = "[0:v]" if prev_label is None else f"[{prev_label}]"
    if source_pix_fmt:
        src += f"format={source_pix_fmt},"
    s = f"d{idx}"
    reference_guard = 0

    if method in {"temporal", "inpaint"} and temporal_patch is not None and img_input_index is not None:
        patch = temporal_patch
        input_idx = img_input_index(patch.path)
        timing = f"setpts=PTS+{patch.start:.8f}/TB" if patch.start else "null"
        head = f"{src}null[full{s}];[{input_idx}:v]{timing}[clean{s}];"
        return head + _seamless_overlay_tail(
            f"clean{s}", s, idx, patch.x, patch.y, patch.width, patch.height,
            (x - patch.x, y - patch.y, w, h), feather, enable_clause, source_pix_fmt,
        )

    if method == "temporal":
        method = "inpaint"
        reference_guard = 2

    def blur_fallback():
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
            source_pix_fmt,
        )

    if method == "blur":
        return _blur_filter_graph(
            src, s, idx, op, x, y, w, h, video_w, video_h, feather, enable_clause,
            source_pix_fmt,
        )

    if method == "inpaint":
        touches_frame = x == 0 or y == 0 or x + w == video_w or y + h == video_h
        if touches_frame:
            return blur_fallback()
        x, y, w, h = _fit_delogo_rect(x, y, w, h, video_w, video_h)
        x0, y0, rw, rh = _build_padded_region(
            x, y, w, h, video_w, video_h, max(2 + reference_guard, feather), aligned=True
        )
        return _inpaint_filter_graph(
            src, s, idx, x, y, w, h, x0, y0, rw, rh, feather, enable_clause,
            source_pix_fmt, reference_guard,
        )

    if method == "mirror":
        mirror_side = op.get("mirror_side") or "right"
        mirror_chain = _build_mirror_patch(
            mirror_side, x, y, w, h, video_w, video_h, f"work{s}", f"clean{s}"
        )
        if mirror_chain is None:
            return blur_fallback()
        if feather <= 0:
            return (
                f"{src}split[full{s}][work{s}];"
                f"{mirror_chain};"
                f"[full{s}][clean{s}]overlay={_delogo_overlay_opts(x, y, enable_clause, source_pix_fmt)}[tmp{idx}]"
            )
        # Blend logo-free context at the seam; keep the logo box fully opaque.
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
                feather, enable_clause, source_pix_fmt,
            )
        return blur_fallback()

    if method == "cover":
        img_path = op.get("delogo_image_path")
        if not img_path or not os.path.exists(img_path):
            logger.warning("Cover delogo skipped: file not found: %s", img_path)
            return None
        if img_input_index is None:
            logger.warning("Cover delogo skipped: img_input_index not available")
            return None
        input_idx = img_input_index(img_path)
        overlay_opts = _delogo_overlay_opts(x, y, enable_clause, source_pix_fmt)
        return (
            f"[{input_idx}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"format=rgba,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black@0[cover{s}];"
            f"{src}[cover{s}]overlay={overlay_opts}[tmp{idx}]"
        )

    x0, y0, rw, rh = _build_padded_region(
        x, y, w, h, video_w, video_h, max(2, feather), aligned=True
    )
    cleanup = _build_cleanup_filter(method, op, rw, rh, enable_clause)

    if feather <= 0:
        return (
            f"{src}split[full{s}][work{s}];"
            f"[work{s}]crop={w}:{h}:{x}:{y}[crop{s}];"
            f"[crop{s}]{cleanup}[clean{s}];"
            f"[full{s}][clean{s}]overlay={_delogo_overlay_opts(x, y, enable_clause, source_pix_fmt)}[tmp{idx}]"
        )

    head = (
        f"{src}split[full{s}][work{s}];"
        f"[work{s}]crop={rw}:{rh}:{x0}:{y0}[crop{s}];"
        f"[crop{s}]{cleanup}[clean{s}];"
    )
    return head + _seamless_overlay_tail(
        f"clean{s}", s, idx, x0, y0, rw, rh, (x - x0, y - y0, w, h),
        feather, enable_clause, source_pix_fmt,
    )
