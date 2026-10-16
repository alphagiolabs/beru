import json
import logging
import math
import os
import re
import subprocess
import threading
from dataclasses import dataclass

import media_probe
from color_validation import _validate_drawtext_color
from frame_geometry import is_identity_transform, transform_filters
from datetime_stamp import (
    clock_parts,
    normalize_clock_fields,
    split_clock_region,
    template_for_tokens,
)
from delogo_chains import _build_delogo_chain
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
    _approximate_letter_spacing_with_hair_spaces,
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


@dataclass(frozen=True)
class DisabledWatermark:
    pass


@dataclass(frozen=True)
class TextWatermark:
    drawtext_filter: str


@dataclass(frozen=True)
class ImageWatermark:
    scale_filter: str
    overlay_position: str
    image_path: str


def _validate_drawtext_text(value):
    for char in value:
        code = ord(char)
        if char != "\n" and (code < 0x20 or code == 0x7F):
            raise ValueError("Drawtext contains forbidden characters")
    return value


def _escape_drawtext_text(value):
    option_value = value.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
    return option_value.replace("'", "'\\''")


def _get_drawtext_options(ffmpeg_path=None):
    with _DRAWTEXT_OPTIONS_LOCK:
        return _probe_drawtext_options(ffmpeg_path or media_probe.FFMPEG)


def _probe_drawtext_options(ffmpeg_path):
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
    global _DRAWTEXT_CACHE_ENABLED
    if _DRAWTEXT_CACHE_ENABLED is None:
        _DRAWTEXT_CACHE_ENABLED = _env_flag("BERU_DRAWTEXT_CACHE", True)
    return _DRAWTEXT_CACHE_ENABLED


def _drawtext_cache_get(cache_key):
    with _DRAWTEXT_CACHE_LOCK:
        cached = _DRAWTEXT_CACHE.pop(cache_key, None)
        if cached is not None:
            _DRAWTEXT_CACHE[cache_key] = cached
        return cached


def _drawtext_cache_store(cache_key, filter_str):
    with _DRAWTEXT_CACHE_LOCK:
        if len(_DRAWTEXT_CACHE) >= _DRAWTEXT_CACHE_MAX:
            _DRAWTEXT_CACHE.pop(next(iter(_DRAWTEXT_CACHE)), None)
        _DRAWTEXT_CACHE[cache_key] = filter_str


def build_drawtext(op, *, ffmpeg_path=None, expansions=None):
    text = (op.get("text") or "").strip()
    if not text:
        return None
    _validate_drawtext_text(text)

    ffmpeg_path = ffmpeg_path or media_probe.FFMPEG
    font_family = str(op.get("font_family", "Arial") or "Arial").strip()
    if not re.fullmatch(r"[\w .-]{1,100}", font_family, re.UNICODE):
        raise ValueError("font_family contains forbidden characters")
    bold = 1 if op.get("bold") else 0
    italic = 1 if op.get("italic") else 0
    font_weight = op.get("font_weight")
    if font_weight is None and bold:
        font_weight = 700
    resolved_font = _resolve_font(
        font_family,
        font_weight=font_weight,
        italic=bool(italic),
        bold=bool(bold),
    )
    cache_key = None
    if _drawtext_cache_enabled():
        try:
            cache_key = (
                ffmpeg_path,
                json.dumps(op, sort_keys=True, separators=(",", ":")),
                resolved_font,
                json.dumps(expansions, sort_keys=True) if expansions else None,
            )
        except (TypeError, ValueError):
            cache_key = None
        if cache_key is not None:
            cached = _drawtext_cache_get(cache_key)
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
        text = _approximate_letter_spacing_with_hair_spaces(text, spacing_px, font_size)
    elif spacing_px < 0 and not native_letter_spacing:
        tight_glyph_layout = True

    font_color = _validate_drawtext_color(op.get("font_color", "white"), "font_color")

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

    font_key, font_val = resolved_font.option, resolved_font.value
    if resolved_font.is_fontfile:
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

    expansion_mode = "normal" if expansions else "none"

    def _drawtext_value(raw):
        escaped = _escape_drawtext_text(raw)
        for placeholder, expansion in (expansions or {}).items():
            escaped = escaped.replace(placeholder, _escape_drawtext_text(expansion))
        return escaped

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
            for glyph in glyphs:
                escaped = _drawtext_value(glyph.glyph)
                gx = int(round(x + glyph.layout_dx))
                gy = int(round(y + glyph.layout_dy))
                parts = [f"text='{escaped}'", f"expansion={expansion_mode}"] + _style_parts(
                    gx, gy, include_line_spacing=False, include_native_spacing=False
                )
                filters.append("drawtext=" + ":".join(parts))
            filter_str = ",".join(filters)
            logger.debug("drawtext tight spacing filter: %s", filter_str[:300])
            if cache_key is not None:
                _drawtext_cache_store(cache_key, filter_str)
            return filter_str

    text = _drawtext_value(text)
    parts = [f"text='{text}'", f"expansion={expansion_mode}"] + _style_parts(
        x_expr, y_expr, include_line_spacing=True, include_native_spacing=True
    )
    filter_str = "drawtext=" + ":".join(parts)
    logger.debug("drawtext filter: %s", filter_str[:300])
    if cache_key is not None:
        _drawtext_cache_store(cache_key, filter_str)
    return filter_str


def _build_watermark_filter(watermark, video_w, video_h) -> DisabledWatermark | TextWatermark | ImageWatermark:
    if not watermark or not watermark.get("enabled"):
        return DisabledWatermark()

    wm_type = watermark.get("type", "text")
    opacity = _coerce_float(watermark.get("opacity", 0.5), 0.5, 0.0, 1.0)
    position = watermark.get("position", "bottom-right")

    margin = 10
    frame_w, frame_h, mark_w, mark_h = (
        ("w", "h", "text_w", "text_h") if wm_type == "text" else ("W", "H", "w", "h")
    )
    pos_map = {
        "top-left": f"{margin}:{margin}",
        "top-center": f"({frame_w}-{mark_w})/2:{margin}",
        "top-right": f"{frame_w}-{mark_w}-{margin}:{margin}",
        "center-left": f"{margin}:({frame_h}-{mark_h})/2",
        "center": f"({frame_w}-{mark_w})/2:({frame_h}-{mark_h})/2",
        "center-right": f"{frame_w}-{mark_w}-{margin}:({frame_h}-{mark_h})/2",
        "bottom-left": f"{margin}:{frame_h}-{mark_h}-{margin}",
        "bottom-center": f"({frame_w}-{mark_w})/2:{frame_h}-{mark_h}-{margin}",
        "bottom-right": f"{frame_w}-{mark_w}-{margin}:{frame_h}-{mark_h}-{margin}",
    }
    xy = pos_map.get(position, pos_map["bottom-right"])

    if wm_type == "text":
        text = watermark.get("text", "")
        if not text.strip():
            return DisabledWatermark()
        _validate_drawtext_text(text)
        font_size = _coerce_int(watermark.get("fontSize", 18), 18, 1, 500)
        font_color = _validate_drawtext_color(watermark.get("fontColor", "white"), "fontColor")
        font_family = str(watermark.get("fontFamily", "Arial") or "Arial").strip()
        if not re.fullmatch(r"[\w .-]{1,100}", font_family, re.UNICODE):
            raise ValueError("fontFamily contains forbidden characters")
        resolved_font = _resolve_font(font_family)
        font_key, font_val = resolved_font.option, resolved_font.value
        if resolved_font.is_fontfile:
            font_val = f"'{font_val}'"
        escaped_text = _escape_drawtext_text(text)
        alpha = f"{opacity:.2f}"
        x_expr, y_expr = xy.split(":")
        dt_parts = [
            f"{font_key}={font_val}",
            f"text='{escaped_text}'",
            "expansion=none",
            f"fontsize={font_size}",
            f"fontcolor={font_color}@{alpha}",
            f"x={x_expr}",
            f"y={y_expr}",
            "shadowx=1",
            "shadowy=1",
            "shadowcolor=black@0.5",
        ]
        return TextWatermark(f"drawtext={':'.join(dt_parts)}")

    elif wm_type == "image":
        img_path = watermark.get("imagePath", "")
        if not img_path or not os.path.exists(img_path):
            return DisabledWatermark()
        scale_factor = _coerce_float(watermark.get("scale", 1), 1.0, 0.05, 20.0)
        target_h = max(16, int(80 * scale_factor))
        x_expr, y_expr = xy.split(":")
        return ImageWatermark(
            f"scale=-1:{target_h},format=rgba,"
            f"colorchannelmixer=aa={opacity:.3f}",
            f"{x_expr}:{y_expr}",
            img_path,
        )

    return DisabledWatermark()


def _text_scale_x(op):
    return _coerce_float(op.get("text_scale_x"), 1.0, 0.5, 3.0)


def _text_graph(op, pieces, prev, n, ffmpeg_path):
    """drawbox drifts chroma when it blends in YUV, so translucent boxes are
    RGBA layers composited by overlay. Layers come from the video itself so
    drawtext ``t`` keeps the frame time.
    """
    enable_clause = _build_enable_clause(op)
    pieces = [p for p in pieces if p[0]["w"] > 0 and p[0]["h"] > 0]
    direct = []
    layers = []
    if _text_bg_enabled(op):
        opacity = _coerce_float(op.get("bg_opacity"), 0.65, 0.0, 1.0)
        color = _validate_drawtext_color(op.get("bg_color", "black"), "bg_color")
        for box, _, _ in pieces:
            if opacity >= 1:
                direct.append(_build_region_bg_drawbox(box, color, opacity, enable_clause))
            elif opacity > 0:
                w, h = max(1, int(box["w"])), max(1, int(box["h"]))
                layers.append((
                    f"crop=2:2:0:0,scale={w}:{h},format=rgba,"
                    f"drawbox=x=0:y=0:w={w}:h={h}:color={color}@{opacity:.3f}:t=fill:replace=1",
                    int(box["x"]), int(box["y"]), enable_clause,
                ))
    scale_x = _text_scale_x(op)
    texts = []
    safe_margin = max(0, _coerce_int(op.get("safe_margin"), 0, 0, 48))
    for box, text, expansions in pieces:
        if abs(scale_x - 1.0) < 1e-6:
            texts.append(build_drawtext({**op, "text": text, "region": box}, ffmpeg_path=ffmpeg_path,
                                        expansions=expansions))
            continue
        inner = _text_layout_bounds(box, safe_margin, _text_box_pad(op))
        if inner["w"] <= 0 or inner["h"] <= 0:
            continue
        layer_w = max(1, math.floor(inner["w"] / scale_x + 0.5))
        dt = build_drawtext(
            {**op, "bg_enabled": False, "safe_margin": 0, "text": text,
             "region": {"x": 0, "y": 0, "w": layer_w, "h": inner["h"]}},
            ffmpeg_path=ffmpeg_path, expansions=expansions,
        )
        if dt:
            layers.append((
                f"crop=2:2:0:0,scale={layer_w}:{inner['h']},format=rgba,colorchannelmixer=aa=0,"
                f"{dt},scale={inner['w']}:{inner['h']}:flags=bicubic",
                inner["x"], inner["y"], "",
            ))
    texts = [t for t in texts if t]
    if not layers:
        chain = ",".join(direct + texts)
        return f"{prev}{chain}[tmp{n}]" if chain else None

    labels = [f"lay{n}_{i}" for i in range(len(layers))]
    head = ",".join(direct + [f"split={len(layers) + 1}[base{n}]" + "".join(f"[src{l}]" for l in labels)])
    graph = [f"{prev}{head}"]
    for (chain, _, _, _), label in zip(layers, labels):
        graph.append(f"[src{label}]{chain}[{label}]")
    current = f"[base{n}]"
    for index, ((_, x, y, enable), label) in enumerate(zip(layers, labels)):
        last = index == len(layers) - 1
        out = f"[tmp{n}]" if last and not texts else f"[ov{label}]"
        graph.append(f"{current}[{label}]overlay={_overlay_opts(x, y, enable)}{out}")
        current = out
    if texts:
        graph.append(f"{current}{','.join(texts)}[tmp{n}]")
    return ";".join(graph)


def _datetime_pieces(op, region):
    blocks = clock_parts(op)
    if not blocks:
        return []
    templates = [template_for_tokens(tokens) for tokens in blocks]
    font_size = _coerce_int(op.get("font_size"), 32, 8, 200)
    inset = max(0, _coerce_int(op.get("safe_margin"), 0, 0, 48)) + _text_box_pad(op)
    boxes = split_clock_region(region, [len(text) for text, _ in templates], font_size, inset)
    return [(box, text, expansions) for (text, expansions), box in zip(templates, boxes)]


def build_filter_complex(operations, video_w, video_h, watermark=None, *, ffmpeg_path=None,
                         source_pix_fmt=None, temporal_resolver=None, transform=None):
    """Build ffmpeg -filter_complex argument for all operations.

    Returns (filter_str, output_label, extra_media_paths). Image inputs loop;
    generated Temporal MKV patches keep their original frame cadence.
    """
    filters = []
    source_w, source_h = video_w, video_h
    crop_x = crop_y = 0
    n = 0
    image_index = {}
    image_paths = []

    def img_input_index(path):
        if path not in image_index:
            image_index[path] = len(image_paths) + 1
            image_paths.append(path)
        return image_index[path]

    stamps = []
    operations = [_normalize_operation(op) for op in operations]
    batch_patches = {}
    batch_through = -1
    batch_prefix_safe = True
    for op_index, op in enumerate(operations):
        mode = op.get("mode")
        if _is_op_time_disabled(op):
            continue
        if mode == "datetime":
            stamps.append(op)
            continue
        region = _region_to_pixels(op.get("region", {}), source_w, source_h)
        if not region:
            continue

        region = {**region, "x": region["x"] - crop_x, "y": region["y"] - crop_y}
        if (region["x"] >= video_w or region["y"] >= video_h
                or region["x"] + region["w"] <= 0 or region["y"] + region["h"] <= 0):
            continue
        if mode == "crop":
            left, top = max(0, region["x"]), max(0, region["y"])
            right = min(video_w, region["x"] + region["w"])
            bottom = min(video_h, region["y"] + region["h"])
            region = {"x": left, "y": top, "w": right - left, "h": bottom - top}
            if region["w"] < 2 or region["h"] < 2:
                continue

        x = region["x"]
        y = region["y"]
        w = region["w"]
        h = region["h"]

        if mode == "text":
            if not (op.get("text") or "").strip():
                continue
            prev = "[0:v]" if n == 0 else f"[tmp{n-1}]"
            graph = _text_graph(op, [(region, op.get("text"), None)], prev, n, ffmpeg_path)
            if not graph:
                continue
            filters.append(graph)
        elif mode == "blur":
            chain = _build_delogo_chain(
                {**op, "region": region, "delogo_method": "blur", "edge_feather": 0},
                f"tmp{n-1}" if n else None, n, video_w, video_h,
                source_pix_fmt=source_pix_fmt,
            )
            if not chain:
                continue
            filters.append(chain)
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
                filters.append(f"{prev}crop={cw}:{ch}:{x}:{y}:exact=1[tmp{n}]")
                crop_x += x
                crop_y += y
                video_w, video_h = cw, ch
        elif mode == "delogo":
            prev = f"tmp{n-1}" if n > 0 else None
            patch = None
            if temporal_resolver and (op.get("delogo_method") or "").lower() in {"temporal", "inpaint"}:
                resolve_batch = getattr(temporal_resolver, "resolve_batch", None)
                if (resolve_batch and batch_prefix_safe and op_index > batch_through
                        and n not in batch_patches):
                    candidates = [{**op, "region": region}]
                    for candidate in operations[op_index + 1:]:
                        if (candidate.get("mode") != "delogo"
                                or (candidate.get("delogo_method") or "").lower() not in {"temporal", "inpaint"}
                                or _is_op_time_disabled(candidate)):
                            break
                        box = _region_to_pixels(candidate.get("region", {}), source_w, source_h)
                        if not box:
                            break
                        box = {**box, "x": box["x"] - crop_x, "y": box["y"] - crop_y}
                        if (box["x"] < 0 or box["y"] < 0 or box["w"] < 2 or box["h"] < 2
                                or box["x"] + box["w"] > video_w or box["y"] + box["h"] > video_h):
                            break
                        candidates.append({**candidate, "region": box})
                    batch_through = op_index + len(candidates) - 1
                    if (len(candidates) > 1 and x >= 0 and y >= 0 and w >= 2 and h >= 2
                            and x + w <= video_w and y + h <= video_h):
                        patches = resolve_batch(
                            list(range(n, n + len(candidates))), candidates, video_w, video_h,
                            ";".join(filters), f"[{prev}]" if prev else "[0:v]", image_paths,
                        )
                        if patches is not None:
                            batch_patches.update(patches)
                if n in batch_patches:
                    patch = batch_patches.pop(n)
                else:
                    patch = temporal_resolver(
                        n, {**op, "region": region}, video_w, video_h,
                        ";".join(filters), f"[{prev}]" if prev else "[0:v]", image_paths,
                    )
            chain = _build_delogo_chain(
                {**op, "region": region}, prev, n, video_w, video_h, img_input_index,
                source_pix_fmt, temporal_patch=patch,
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
        batch_prefix_safe = (mode in {"delogo", "blur"} or (
            batch_prefix_safe and mode == "crop" and not _build_enable_clause(op)
        ))
        n += 1

    if watermark and watermark.get("enabled"):
        wm_type = watermark.get("type", "text")
        if wm_type in ("text", "image"):
            wm_result = _build_watermark_filter(watermark, video_w, video_h)
            prev = f"[tmp{n-1}]" if n > 0 else "[0:v]"
            if isinstance(wm_result, TextWatermark):
                filters.append(f"{prev}{wm_result.drawtext_filter}[tmp{n}]")
                n += 1
            elif isinstance(wm_result, ImageWatermark):
                idx = img_input_index(wm_result.image_path)
                filters.append(
                    f"[{idx}:v]{wm_result.scale_filter}[wm{n}];"
                    f"{prev}[wm{n}]overlay={wm_result.overlay_position}[tmp{n}]"
                )
                n += 1

    if transform is not None and not is_identity_transform(transform):
        chain, (video_w, video_h) = transform_filters(transform, video_w, video_h)
        if chain:
            prev = f"[tmp{n-1}]" if n > 0 else "[0:v]"
            filters.append(f"{prev}{','.join(chain)}[tmp{n}]")
            n += 1

    for op in stamps:
        region = _region_to_pixels(op.get("region", {}), video_w, video_h)
        if not region:
            continue
        op = {**normalize_clock_fields(op), "auto_fit": False, "text_wrap": False,
              "truncate": "none", "line_height": 1}
        prev = "[0:v]" if n == 0 else f"[tmp{n-1}]"
        graph = _text_graph(op, _datetime_pieces(op, region), prev, n, ffmpeg_path)
        if graph:
            filters.append(graph)
            n += 1

    if n == 0:
        return None, None, []

    return ";".join(filters), f"[tmp{n - 1}]", image_paths
