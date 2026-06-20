"""Color validation for FFmpeg filter strings.

Extracted from ``processor.py`` so that filter-chain builders (e.g.
``delogo_chains.py``) can re-validate colors defensively without importing
``processor`` (which would be circular).  ``processor.py`` re-exports
``_validate_drawtext_color`` for backwards compatibility with the test suite.
"""

import re

_ALLOWED_NAMED_COLORS = frozenset(
    {
        "aqua",
        "black",
        "blue",
        "brown",
        "cyan",
        "fuchsia",
        "gold",
        "gray",
        "green",
        "grey",
        "lime",
        "magenta",
        "maroon",
        "navy",
        "olive",
        "orange",
        "pink",
        "purple",
        "red",
        "silver",
        "teal",
        "transparent",
        "white",
        "yellow",
    }
)
_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_RGBA_COLOR_RE = re.compile(
    r"^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*"
    r"(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$",
    re.IGNORECASE,
)


def _validate_drawtext_color(value, field_name):
    color = str(value or "").strip()
    if not color:
        raise ValueError(f"{field_name} is empty")
    if _HEX_COLOR_RE.fullmatch(color) or color.lower() in _ALLOWED_NAMED_COLORS:
        return color
    rgba = _RGBA_COLOR_RE.fullmatch(color)
    if rgba and all(0 <= int(channel) <= 255 for channel in rgba.groups()[:3]):
        red, green, blue = (int(channel) for channel in rgba.groups()[:3])
        alpha = round(float(rgba.group(4)) * 255)
        return f"#{red:02x}{green:02x}{blue:02x}{alpha:02x}"
    raise ValueError(f"{field_name} is not an allowed color")
