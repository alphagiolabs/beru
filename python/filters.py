"""Drawtext and filter-graph construction.

Patch drawtext option and filter caches here; processor.py re-exports helpers.
"""

import json
import logging
import os
import re
import subprocess
import threading

import media_probe
from color_validation import _validate_drawtext_color
from delogo_chains import _build_boxblur_filter, _build_delogo_chain
from fonts import _resolve_font
from op_shared import (
    _build_enable_clause,
    _coerce_float,
    _coerce_int,
    _env_flag,
    _is_op_time_disabled,
    _normalize_operation,
    _overlay_opts,
    _region_to_pixels,
)
from text_layout_helpers import (
    _apply_letter_spacing_fallback,
    _build_region_bg_drawbox,
    _layout_export_text,
    _text_bg_enabled,
    _text_box_pad,
    _text_glyph_positions,
    _text_layout_bounds,
)

logger = logging.getLogger("beru")

_DRAWTEXT_CACHE = {}
_DRAWTEXT_CACHE_LOCK = threading.Lock()
_DRAWTEXT_CACHE_ENABLED = None
_DRAWTEXT_CACHE_MAX = 512

_DRAWTEXT_OPTIONS_CACHE = None
_DRAWTEXT_OPTIONS_CACHE_FOR = None
_DRAWTEXT_OPTIONS_LOCK = threading.Lock()

_DRAWTEXT_FORBIDDEN_CHARS = frozenset("[]")


def _validate_drawtext_text(value):
    """Reject control characters and filtergraph pad tokens.

    `_escape_drawtext_text` neutralizes \\ : ' = ; , % { } and newlines, so
    emoji, CJK, arrows and combining marks render safely (subject to font
    glyph coverage) instead of failing the whole job. `[` and `]` stay
    forbidden because escaping does not neutralize the pad-reference syntax.
    """
    for char in value:
        if char in _DRAWTEXT_FORBIDDEN_CHARS:
            raise ValueError("Drawtext contains forbidden characters")
        code = ord(char)
        if char != "\n" and (code < 0x20 or code == 0x7F):
            raise ValueError("Drawtext contains forbidden characters")
    return value


def _escape_drawtext_text(value):
    return (
        value.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("=", "\\=")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("%", "\\%")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\n", "\\n")
        .replace("\r", "")
    )


def _get_drawtext_options(ffmpeg_path=None):
    with _DRAWTEXT_OPTIONS_LOCK:
        return _probe_drawtext_options(ffmpeg_path or media_probe.FFMPEG)


def _probe_drawtext_options(ffmpeg_path):
    """Return supported drawtext option names for the active FFmpeg binary."""
    global _DRAWTEXT_OPTIONS_CACHE, _DRAWTEXT_OPTIONS_CACHE_FOR
    if _DRAWTEXT_OPTIONS_CACHE is not None and _DRAWTEXT_OPTIONS_CACHE_FOR == ffmpeg_path:
        return _DRAWTEXT_OPTIONS_CACHE

    options = set()
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-h", "filter=drawtext"],
            capture_output=True, text=True, timeout=10,
        )
        help_text = (result.stdout or "") + (result.stderr or "")
        options = set(re.findall(r"^\s+([A-Za-z0-9_]+)\s+<", help_text, re.MULTILINE))
    except Exception as e:
        logger.warning("drawtext option detection failed: %s", e)

    _DRAWTEXT_OPTIONS_CACHE = options
    _DRAWTEXT_OPTIONS_CACHE_FOR = ffmpeg_path
    return options


def _drawtext_supports(option_name, ffmpeg_path=None):
    return option_name in _get_drawtext_options(ffmpeg_path)


def _drawtext_cache_enabled():
    """Lazily read the env flag once. On by default; 0/false/no/off opts out.

    Cached filter strings depend on the op dict and the FFmpeg binary.
    """
    global _DRAWTEXT_CACHE_ENABLED
    if _DRAWTEXT_CACHE_ENABLED is None:
        _DRAWTEXT_CACHE_ENABLED = _env_flag("BERU_DRAWTEXT_CACHE", True)
    return _DRAWTEXT_CACHE_ENABLED


def _drawtext_cache_store(cache_key, filter_str):
    """Insert into the memo cache with FIFO eviction once the cap is reached."""
    with _DRAWTEXT_CACHE_LOCK:
        if len(_DRAWTEXT_CACHE) >= _DRAWTEXT_CACHE_MAX:
            _DRAWTEXT_CACHE.pop(next(iter(_DRAWTEXT_CACHE)), None)
        _DRAWTEXT_CACHE[cache_key] = filter_str


def build_drawtext(op, *, ffmpeg_path=None):
    """Build ffmpeg drawtext filter string from operation."""
    text = (op.get("text") or "").strip()
    if not text:
        return None
    _validate_drawtext_text(text)

    ffmpeg_path = ffmpeg_path or media_probe.FFMPEG
    cache_key = None
    if _drawtext_cache_enabled():
        try:
            cache_key = (ffmpeg_path, json.dumps(op, sort_keys=True, separators=(",", ":")))
        except (TypeError, ValueError):
            cache_key = None
        if cache_key is not None:
            cached = _DRAWTEXT_CACHE.get(cache_key)
            if cached is not None:
                return cached

    region = op.get("region", {}) or {}
    try:
        safe_margin = int(op.get("safe_margin", 0) or 0)
    except (TypeError, ValueError):
        safe_margin = 0
    safe_margin = max(0, safe_margin)

    layout = _text_layout_bounds(region, safe_margin, _text_box_pad(op))
    x = layout["x"]
    y = layout["y"]
    region_w = layout["w"]
    region_h = layout["h"]

    try:
        line_height = float(op.get("line_height", 1.2))
    except (TypeError, ValueError):
        line_height = 1.2
    laid = _layout_export_text(
        text,
        region_w,
        region_h,
        font_size=op.get("font_size", 32),
        line_height=line_height,
        text_wrap=op.get("text_wrap", True),
        auto_fit=op.get("auto_fit"),
        truncate=op.get("truncate"),
    )
    font_size = laid["font_size"]
    text = laid["display_text"]

    letter_spacing = op.get("letter_spacing", 0)
    try:
        spacing_px = int(round(float(letter_spacing)))
    except (TypeError, ValueError):
        spacing_px = 0
    spacing_px = max(-20, min(80, spacing_px))
    native_letter_spacing = spacing_px != 0 and _drawtext_supports("spacing", ffmpeg_path)
    tight_glyph_layout = False
    if spacing_px > 0 and not native_letter_spacing:
        text = _apply_letter_spacing_fallback(text, spacing_px, font_size)
    elif spacing_px < 0 and not native_letter_spacing:
        tight_glyph_layout = True

    font_color = _validate_drawtext_color(op.get("font_color", "white"), "font_color")
    font_family = str(op.get("font_family", "Arial") or "Arial").strip()
    if not re.fullmatch(r"[\w .-]{1,100}", font_family, re.UNICODE):
        raise ValueError("font_family contains forbidden characters")
    bold = 1 if op.get("bold") else 0
    italic = 1 if op.get("italic") else 0
    font_weight = op.get("font_weight")
    if font_weight is None and bold:
        font_weight = 700

    text_align = op.get("text_align", "left")
    vertical_align = str(op.get("vertical_align") or "top").lower()

    if text_align == "center" and region_w > 0:
        x_expr = f"{x} + ({region_w} - text_w) / 2"
    elif text_align == "right" and region_w > 0:
        x_expr = f"{x} + {region_w} - text_w"
    else:
        x_expr = str(x)

    if vertical_align == "center" and region_h > 0:
        y_expr = f"{y} + ({region_h} - text_h) / 2"
    elif vertical_align == "bottom" and region_h > 0:
        y_expr = f"{y} + {region_h} - text_h"
    else:
        y_expr = str(y)

    font_key, font_val, is_fontfile = _resolve_font(
        font_family,
        font_weight=font_weight,
        italic=bool(italic),
        bold=bool(bold),
    )
    if is_fontfile:
        font_val = f"'{font_val}'"

    text_opacity = op.get("text_opacity", 1)
    try:
        text_opacity = float(text_opacity)
    except (TypeError, ValueError):
        text_opacity = 1.0
    text_opacity = max(0.0, min(1.0, text_opacity))
    if text_opacity < 1.0:
        font_color = f"{font_color}@{text_opacity:.3f}"

    def _style_parts(x_val, y_val, include_line_spacing=True, include_native_spacing=False):
        parts = [
            f"fontsize={font_size}",
            f"fontcolor={font_color}",
            f"{font_key}={font_val}",
            f"x={x_val}",
            f"y={y_val}",
        ]
        if _drawtext_supports("y_align", ffmpeg_path):
            parts.append("y_align=text")
        if font_weight is not None and _drawtext_supports("fontweight", ffmpeg_path):
            try:
                fw = int(font_weight)
                if 100 <= fw <= 1000:
                    parts.append(f"fontweight={fw}")
            except (TypeError, ValueError):
                pass
        if italic and _drawtext_supports("fontstyle", ffmpeg_path):
            parts.append("fontstyle=italic")
        if include_native_spacing and native_letter_spacing:
            parts.append(f"spacing={spacing_px}")
        if include_line_spacing:
            line_spacing_px = int(round(float(font_size) * max(0.0, line_height - 1.0)))
            if line_spacing_px > 0 and _drawtext_supports("line_spacing", ffmpeg_path):
                parts.append(f"line_spacing={line_spacing_px}")
        border_w = _coerce_int(op.get("border_width"), 0, 0, 24)
        if border_w > 0:
            border_color = _validate_drawtext_color(op.get("border_color", "black"), "border_color")
            parts.append(f"bordercolor={border_color}:borderw={border_w}")
        if op.get("text_shadow_enabled"):
            shadow_color = _validate_drawtext_color(
                op.get("text_shadow_color", "black"), "text_shadow_color"
            )
            try:
                shadow_x = int(round(float(op.get("text_shadow_offset_x", 2))))
            except (TypeError, ValueError):
                shadow_x = 2
            try:
                shadow_y = int(round(float(op.get("text_shadow_offset_y", 2))))
            except (TypeError, ValueError):
                shadow_y = 2
            shadow_x = max(-64, min(64, shadow_x))
            shadow_y = max(-64, min(64, shadow_y))
            if shadow_x or shadow_y:
                parts.append(
                    f"shadowcolor={shadow_color}:shadowx={shadow_x}:shadowy={shadow_y}"
                )
        enable_clause = _build_enable_clause(op)
        if enable_clause:
            parts.append(enable_clause)
        return parts

    if tight_glyph_layout:
        glyphs = _text_glyph_positions(
            text,
            spacing_px,
            font_size,
            line_height=line_height,
            region_w=region_w,
            region_h=region_h,
            text_align=text_align,
            vertical_align=vertical_align,
        )
        if len(glyphs) >= 2:
            filters = []
            for cluster, dx, dy in glyphs:
                escaped = _escape_drawtext_text(cluster)
                gx = int(round(x + dx))
                gy = int(round(y + dy))
                parts = [f"text='{escaped}'"] + _style_parts(
                    gx, gy, include_line_spacing=False, include_native_spacing=False
                )
                filters.append("drawtext=" + ":".join(parts))
            filter_str = ",".join(filters)
            logger.debug("drawtext tight spacing filter: %s", filter_str[:300])
            if cache_key is not None:
                _drawtext_cache_store(cache_key, filter_str)
            return filter_str

    text = _escape_drawtext_text(text)
    parts = [f"text='{text}'"] + _style_parts(
        x_expr, y_expr, include_line_spacing=True, include_native_spacing=True
    )
    filter_str = "drawtext=" + ":".join(parts)
    logger.debug("drawtext filter: %s", filter_str[:300])
    if cache_key is not None:
        _drawtext_cache_store(cache_key, filter_str)
    return filter_str


def _build_watermark_filter(watermark, video_w, video_h):
    """Build FFmpeg filter for a global watermark (text or image overlay).

    Returns (filter_snippet, overlay_position_or_None, image_path). For text
    watermarks the second value is None; for image watermarks it is the
    "x:y" overlay position. (None, False, None) when disabled or invalid.
    """
    if not watermark or not watermark.get("enabled"):
        return None, False, None

    wm_type = watermark.get("type", "text")
    opacity = _coerce_float(watermark.get("opacity", 0.5), 0.5, 0.0, 1.0)
    position = watermark.get("position", "bottom-right")

    margin = 10
    pos_map = {
        "top-left": f"{margin}:{margin}",
        "top-center": f"(W-w)/2:{margin}",
        "top-right": f"W-w-{margin}:{margin}",
        "center-left": f"{margin}:(H-h)/2",
        "center": "(W-w)/2:(H-h)/2",
        "center-right": f"W-w-{margin}:(H-h)/2",
        "bottom-left": f"{margin}:H-h-{margin}",
        "bottom-center": f"(W-w)/2:H-h-{margin}",
        "bottom-right": f"W-w-{margin}:H-h-{margin}",
    }
    xy = pos_map.get(position, pos_map["bottom-right"])

    if wm_type == "text":
        text = watermark.get("text", "")
        if not text.strip():
            return None, False, None
        _validate_drawtext_text(text)
        font_size = _coerce_int(watermark.get("fontSize", 18), 18, 1, 500)
        font_color = _validate_drawtext_color(watermark.get("fontColor", "white"), "fontColor")
        font_family = str(watermark.get("fontFamily", "Arial") or "Arial").strip()
        if not re.fullmatch(r"[\w .-]{1,100}", font_family, re.UNICODE):
            raise ValueError("fontFamily contains forbidden characters")
        font_key, font_val, is_fontfile = _resolve_font(font_family)
        if is_fontfile:
            font_val = f"'{font_val}'"
        escaped_text = _escape_drawtext_text(text)
        alpha = f"{opacity:.2f}"
        x_expr, y_expr = xy.split(":")
        dt_parts = [
            f"{font_key}={font_val}",
            f"text='{escaped_text}'",
            f"fontsize={font_size}",
            f"fontcolor={font_color}@{alpha}",
            f"x={x_expr}",
            f"y={y_expr}",
            "shadowx=1",
            "shadowy=1",
            "shadowcolor=black@0.5",
        ]
        return f"drawtext={':'.join(dt_parts)}", False, None

    elif wm_type == "image":
        img_path = watermark.get("imagePath", "")
        if not img_path or not os.path.exists(img_path):
            return None, False, None
        scale_factor = _coerce_float(watermark.get("scale", 1), 1.0, 0.05, 20.0)
        target_h = max(16, int(80 * scale_factor))
        x_expr, y_expr = xy.split(":")
        return (
            f"scale=-1:{target_h},format=rgba,"
            f"colorchannelmixer=aa={opacity:.3f}",
            f"{x_expr}:{y_expr}",
            img_path,
        )

    return None, False, None


def build_filter_complex(operations, video_w, video_h, watermark=None, *, ffmpeg_path=None):
    """Build ffmpeg -filter_complex argument for all operations.

    Returns (filter_str, output_label, extra_image_paths) where extra_image_paths
    is the list of image file paths to pass as additional `-loop 1 -i <path>` inputs.
    """
    filters = []
    n = 0
    image_index = {}
    image_paths = []

    def img_input_index(path):
        if path not in image_index:
            image_index[path] = len(image_paths) + 1
            image_paths.append(path)
        return image_index[path]

    for raw_op in operations:
        op = _normalize_operation(raw_op)
        mode = op.get("mode")
        if _is_op_time_disabled(op):
            continue
        region = _region_to_pixels(op.get("region", {}), video_w, video_h)
        if not region:
            continue

        x = region["x"]
        y = region["y"]
        w = region["w"]
        h = region["h"]

        if mode == "text":
            if not (op.get("text") or "").strip():
                continue
            enable_clause = _build_enable_clause(op)
            segments = []
            if _text_bg_enabled(op):
                bg_color = op.get("bg_color", "black")
                bg_opacity = op.get("bg_opacity", 0.65)
                segments.append(
                    _build_region_bg_drawbox(region, bg_color, bg_opacity, enable_clause)
                )
            dt = build_drawtext({**op, "region": region}, ffmpeg_path=ffmpeg_path)
            if dt:
                segments.append(dt)
            if not segments:
                continue
            chain = ",".join(segments)
            prev = "[0:v]" if n == 0 else f"[tmp{n-1}]"
            filters.append(f"{prev}{chain}[tmp{n}]")
        elif mode == "blur":
            strength = _coerce_int(op.get("blur_strength"), 20, 1, 100)
            luma = max(1, min(100, strength // 3))
            enable_clause = _build_enable_clause(op)
            overlay_opts = _overlay_opts(x, y, enable_clause)
            blur_filter = _build_boxblur_filter(luma, power=3)
            if enable_clause:
                blur_filter += f":{enable_clause}"
            prev = "[0:v]" if n == 0 else f"[tmp{n-1}]"
            filters.append(
                f"{prev}split[bg{n}][fg{n}];"
                f"[bg{n}]crop={w}:{h}:{x}:{y},{blur_filter}[blur{n}];"
                f"[fg{n}][blur{n}]overlay={overlay_opts}[tmp{n}]"
            )
        elif mode == "crop":
            enable_clause = _build_enable_clause(op)
            prev = "[0:v]" if n == 0 else f"[tmp{n-1}]"
            if enable_clause:
                overlay_opts = _overlay_opts(0, 0, enable_clause)
                filters.append(
                    f"{prev}split[full{n}][crop_in{n}];"
                    f"[crop_in{n}]crop={w}:{h}:{x}:{y},scale={video_w}:{video_h}:flags=fast_bilinear[cropped{n}];"
                    f"[full{n}][cropped{n}]overlay={overlay_opts}[tmp{n}]"
                )
            else:
                cw, ch = int(w), int(h)
                if cw % 2:
                    cw = max(2, cw - 1)
                if ch % 2:
                    ch = max(2, ch - 1)
                filters.append(f"{prev}crop={cw}:{ch}:{x}:{y}[tmp{n}]")
                video_w, video_h = cw, ch
        elif mode == "delogo":
            prev = f"tmp{n-1}" if n > 0 else None
            chain = _build_delogo_chain(
                {**op, "region": region}, prev, n, video_w, video_h, img_input_index
            )
            if chain:
                filters.append(chain)
            else:
                continue
        elif mode == "image":
            img_path = op.get("image_path")
            if not img_path or not os.path.exists(img_path):
                logger.warning("Image op skipped: file not found: %s", img_path)
                continue
            idx = img_input_index(img_path)
            opacity = _coerce_float(op.get("image_opacity"), 1.0, 0.0, 1.0)
            overlay_opts = _overlay_opts(x, y, _build_enable_clause(op))
            prev = "[0:v]" if n == 0 else f"[tmp{n-1}]"
            filters.append(
                f"[{idx}:v]scale={w}:{h},"
                f"format=rgba,"
                f"colorchannelmixer=aa={opacity:.3f}[ov{n}];"
                f"{prev}[ov{n}]overlay={overlay_opts}[tmp{n}]"
            )
        else:
            continue
        n += 1

    if watermark and watermark.get("enabled"):
        wm_type = watermark.get("type", "text")
        if wm_type in ("text", "image"):
            wm_result = _build_watermark_filter(watermark, video_w, video_h)
            prev = f"[tmp{n-1}]" if n > 0 else "[0:v]"
            if wm_type == "text":
                if wm_result and wm_result[0]:
                    filters.append(f"{prev}{wm_result[0]}[tmp{n}]")
                    n += 1
            elif wm_result and len(wm_result) == 3 and wm_result[2]:
                scale_filter, overlay_pos, img_path = wm_result
                idx = img_input_index(img_path)
                filters.append(
                    f"[{idx}:v]{scale_filter}[wm{n}];"
                    f"{prev}[wm{n}]overlay={overlay_pos}[tmp{n}]"
                )
                n += 1

    if n == 0:
        return None, None, []

    return ";".join(filters), f"[tmp{n - 1}]", image_paths
