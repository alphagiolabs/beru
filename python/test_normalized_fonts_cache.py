"""Regression: the normalized font map must track the catalogue it derives from.

`_get_normalized_fonts` memoizes the normalized view of the system font
catalogue that `_SYSTEM_FONTS_CACHE` already memoizes. The invalidation trap is
that a font installed after the first call must still be visible: the cache is
keyed to the catalogue by identity, so a replaced catalogue forces a rebuild
instead of serving a normalized view of a map that is no longer current.
"""

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

import fonts as fonts_module  # noqa: E402
import processor  # noqa: E402


def _reset_normalized_fonts_cache():
    fonts_module._normalized_fonts_state = None


def test_normalized_font_map_is_rebuilt_when_the_catalogue_is_replaced():
    _reset_normalized_fonts_cache()
    first = {"arial": ("C:/fonts/arial.ttf", "arial")}
    second = {
        "arial": ("C:/fonts/arial.ttf", "arial"),
        "roboto": ("C:/fonts/roboto.ttf", "roboto"),
    }

    assert processor._get_normalized_fonts(first) == {"arial": first["arial"]}
    assert processor._get_normalized_fonts(first) == {"arial": first["arial"]}
    rebuilt = processor._get_normalized_fonts(second)
    assert "roboto" in rebuilt, "a font added to the catalogue must become visible"
    assert rebuilt["roboto"] == second["roboto"]


def test_normalized_font_map_is_built_once_for_a_stable_catalogue():
    _reset_normalized_fonts_cache()
    real_key = processor._font_name_key
    fonts = {"arial": ("C:/fonts/arial.ttf", "arial")}
    calls = 0

    def _counting_key(value):
        nonlocal calls
        calls += 1
        return real_key(value)

    with patch.object(fonts_module, "_font_name_key", side_effect=_counting_key):
        assert processor._get_normalized_fonts(fonts) == {"arial": fonts["arial"]}
        assert calls == 1
        assert processor._get_normalized_fonts(fonts) == {"arial": fonts["arial"]}
    assert calls == 1, "cached lookups must not re-normalize the catalogue"


if __name__ == "__main__":
    test_normalized_font_map_is_rebuilt_when_the_catalogue_is_replaced()
    test_normalized_font_map_is_built_once_for_a_stable_catalogue()
    print("ALL PASSED")
