import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

import fonts as fonts_module  # noqa: E402


def _reset_normalized_fonts_cache():
    fonts_module._normalized_fonts_state = None


def test_normalized_font_map_is_rebuilt_when_the_catalogue_is_replaced():
    _reset_normalized_fonts_cache()
    first = {"arial": ("C:/fonts/arial.ttf", "arial")}
    second = {
        "arial": ("C:/fonts/arial.ttf", "arial"),
        "roboto": ("C:/fonts/roboto.ttf", "roboto"),
    }

    assert fonts_module._get_normalized_fonts(first) == {"arial": first["arial"]}
    assert fonts_module._get_normalized_fonts(first) == {"arial": first["arial"]}
    rebuilt = fonts_module._get_normalized_fonts(second)
    assert "roboto" in rebuilt, "a font added to the catalogue must become visible"
    assert rebuilt["roboto"] == second["roboto"]


def test_normalized_font_map_is_built_once_for_a_stable_catalogue():
    _reset_normalized_fonts_cache()
    real_key = fonts_module._font_name_key
    fonts = {"arial": ("C:/fonts/arial.ttf", "arial")}
    calls = 0

    def _counting_key(value):
        nonlocal calls
        calls += 1
        return real_key(value)

    with patch.object(fonts_module, "_font_name_key", side_effect=_counting_key):
        assert fonts_module._get_normalized_fonts(fonts) == {"arial": fonts["arial"]}
        assert calls == 1
        assert fonts_module._get_normalized_fonts(fonts) == {"arial": fonts["arial"]}
    assert calls == 1, "cached lookups must not re-normalize the catalogue"


if __name__ == "__main__":
    test_normalized_font_map_is_rebuilt_when_the_catalogue_is_replaced()
    test_normalized_font_map_is_built_once_for_a_stable_catalogue()
    print("ALL PASSED")
