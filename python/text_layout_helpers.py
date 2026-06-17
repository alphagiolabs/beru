"""Pure text-layout/drawtext math helpers for processor.py.

Extracted from the ``processor.py`` monolith.  These are the stateless
wrapping / fitting / spacing helpers used by ``build_drawtext`` (which stays
in ``processor.py`` because it calls monkeypatched functions like
``_resolve_font`` and ``_drawtext_supports``).  None of these helpers are
monkeypatched by the test suite, so they are safe to live in their own module.

No logger is needed here — these helpers are pure string/number math.
"""

import re
import unicodedata


def _estimate_char_width(font_size):
    try:
        font_size = float(font_size)
    except (TypeError, ValueError):
        font_size = 32
    return max(4.0, font_size * 0.55)


def _wrap_text_to_width(text, max_width_px, font_size):
    """Word-wrap using the same heuristic as src/utils/text-layout.js."""
    raw = str(text or "")
    if not raw or max_width_px <= 0:
        return raw
    max_chars = max(1, int(max_width_px / _estimate_char_width(font_size)))
    longest_line = max((len(line) for line in raw.split("\n")), default=0)
    if longest_line <= max_chars:
        return raw
    lines = []
    for paragraph in raw.split("\n"):
        tokens = re.split(r"(\s+)", paragraph)
        line = ""
        for token in tokens:
            if not token:
                continue
            next_line = line + token
            if len(next_line) <= max_chars or not line:
                line = next_line
            else:
                if line.strip():
                    lines.append(line.rstrip())
                line = token.lstrip()
        if line.strip() or paragraph == "":
            lines.append(line.rstrip() if line.strip() else "")
        elif line:
            lines.append(line.rstrip())
    return "\n".join(lines)


def _truncate_text(text, max_width_px, font_size, mode):
    raw = str(text or "")
    if mode != "ellipsis" or not raw or max_width_px <= 0:
        return raw
    max_chars = max(1, int(max_width_px / _estimate_char_width(font_size)))
    if len(raw.replace("\n", "")) <= max_chars:
        return raw
    keep = max(1, max_chars - 1)
    return raw[:keep].rstrip() + "…"


def _fit_font_size(text, region_w, region_h, base_size, line_height, wrap, min_size=8):
    try:
        base_size = int(base_size)
    except (TypeError, ValueError):
        base_size = 32
    try:
        line_height = float(line_height)
    except (TypeError, ValueError):
        line_height = 1.2
    try:
        region_w = int(region_w)
        region_h = int(region_h)
    except (TypeError, ValueError):
        region_w = 0
        region_h = 0
    min_size = max(8, int(min_size))
    size = max(min_size, base_size)
    if region_w <= 0 or region_h <= 0:
        return size
    while size >= min_size:
        display = _wrap_text_to_width(text, region_w, size) if wrap else str(text or "")
        line_count = max(1, display.count("\n") + 1) if display else 1
        longest = max((len(line) for line in display.split("\n")), default=0)
        total_h = line_count * size * line_height
        line_w = longest * _estimate_char_width(size)
        if total_h <= region_h and line_w <= region_w:
            return size
        size -= 1
    return min_size


def _text_clusters(text):
    """Group combining marks and joined emoji so spacing is only added between glyphs."""
    clusters = []
    join_next = False
    for char in text:
        codepoint = ord(char)
        is_variation_selector = (
            0xFE00 <= codepoint <= 0xFE0F or 0xE0100 <= codepoint <= 0xE01EF
        )
        if clusters and (join_next or unicodedata.combining(char) or is_variation_selector):
            clusters[-1] += char
            join_next = char == "\u200d"
        elif char == "\u200d" and clusters:
            clusters[-1] += char
            join_next = True
        else:
            clusters.append(char)
            join_next = False
    return clusters


def _apply_letter_spacing_fallback(text, spacing_px, font_size):
    """Approximate CSS letter-spacing when drawtext lacks a native spacing option."""
    try:
        spacing_px = max(0.0, float(spacing_px))
        font_size = max(1.0, float(font_size))
    except (TypeError, ValueError):
        return text
    if spacing_px <= 0:
        return text

    # U+200A is roughly 1/12 em in FreeType. Distributing it cumulatively keeps
    # the total requested width accurate even when one spacer is wider than 1 px.
    spacer = "\u200a"
    spacer_width = max(1.0, font_size / 12.0)
    spaced_lines = []
    for line in str(text).split("\n"):
        clusters = _text_clusters(line)
        if len(clusters) < 2:
            spaced_lines.append(line)
            continue
        parts = []
        target_width = 0.0
        emitted_spacers = 0
        for index, cluster in enumerate(clusters):
            parts.append(cluster)
            if index == len(clusters) - 1:
                continue
            target_width += spacing_px
            total_spacers = int(round(target_width / spacer_width))
            spacer_count = max(0, total_spacers - emitted_spacers)
            if spacer_count:
                parts.append(spacer * spacer_count)
                emitted_spacers += spacer_count
        spaced_lines.append("".join(parts))
    return "\n".join(spaced_lines)


def _text_bg_enabled(op):
    bg = op.get("bg_enabled", True)
    if isinstance(bg, str):
        return bg.lower() not in ("0", "false", "no")
    return bool(bg)


def _text_box_pad(op):
    """Inner text padding when the region background is enabled (matches CSS preview)."""
    if not _text_bg_enabled(op):
        return 0
    try:
        box_pad = int(op.get("box_border_width", 4))
    except (TypeError, ValueError):
        box_pad = 4
    return max(0, box_pad)


def _text_layout_bounds(region, safe_margin, box_pad):
    """Usable text area inside a region (safe margin + optional box padding)."""
    rx = int(region.get("x", 0))
    ry = int(region.get("y", 0))
    rw = int(region.get("w", 0))
    rh = int(region.get("h", 0))
    inset = max(0, safe_margin) + max(0, box_pad)
    return {
        "x": rx + inset,
        "y": ry + inset,
        "w": max(0, rw - (2 * inset)),
        "h": max(0, rh - (2 * inset)),
    }


def _build_region_bg_drawbox(region, bg_color, bg_opacity, enable_clause=""):
    """Fill the full text region — CSS preview paints inset:0, not a glyph box."""
    x = int(region.get("x", 0))
    y = int(region.get("y", 0))
    w = max(1, int(region.get("w", 0)))
    h = max(1, int(region.get("h", 0)))
    try:
        bg_opacity = float(bg_opacity)
    except (TypeError, ValueError):
        bg_opacity = 0.65
    bg_opacity = max(0.0, min(1.0, bg_opacity))
    parts = [
        f"x={x}",
        f"y={y}",
        f"w={w}",
        f"h={h}",
        f"color={bg_color}@{bg_opacity:.3f}",
        "t=fill",
    ]
    if enable_clause:
        parts.append(enable_clause)
    return "drawbox=" + ":".join(parts)
