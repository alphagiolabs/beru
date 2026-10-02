"""Regression: `border_width` must be coerced and clamped before it reaches the
drawtext filtergraph.

It used to be read raw (`op.get("border_width", 0)`) and compared with `> 0`, so
a non-numeric value from a hand-edited manifest raised a TypeError that escaped
as a raw traceback instead of a mapped job error. The renderer already clamps
this field to 0-24 (`src/utils/text-style.js`), so the processor clamps to the
same range and valid values pass through unchanged.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from processor import build_drawtext  # noqa: E402


def _text_op(**overrides):
    op = {
        "mode": "text",
        "text": "Hola",
        "region": {"x": 0, "y": 0, "w": 320, "h": 200},
        "font_size": 32,
    }
    op.update(overrides)
    return op


def test_non_numeric_border_width_does_not_raise():
    for bad in ("abc", [], {}, 1.5 + 2j):
        filter_str = build_drawtext(_text_op(border_width=bad))
        assert filter_str is not None
        assert "borderw=" not in filter_str, (
            f"border_width={bad!r} should fall back to no border, got: {filter_str!r}"
        )


def test_border_width_out_of_range_is_clamped():
    assert "borderw=24" in build_drawtext(_text_op(border_width=999))
    assert "borderw=0" not in build_drawtext(_text_op(border_width=999))
    assert "borderw=" not in build_drawtext(_text_op(border_width=-5))


def test_valid_border_width_is_emitted_unchanged():
    assert "borderw=4" in build_drawtext(_text_op(border_width=4))
    assert "bordercolor=black" in build_drawtext(_text_op(border_width=4))
    assert "borderw=24" in build_drawtext(_text_op(border_width=24))


def test_numeric_string_border_width_is_accepted():
    assert "borderw=6" in build_drawtext(_text_op(border_width="6"))
    assert "borderw=24" in build_drawtext(_text_op(border_width="600"))


def test_boolean_border_width_follows_int_semantics():
    assert "borderw=1" in build_drawtext(_text_op(border_width=True))
    assert "borderw=" not in build_drawtext(_text_op(border_width=False))


if __name__ == "__main__":
    test_non_numeric_border_width_does_not_raise()
    test_border_width_out_of_range_is_clamped()
    test_valid_border_width_is_emitted_unchanged()
    test_numeric_string_border_width_is_accepted()
    test_boolean_border_width_follows_int_semantics()
    print("ALL PASSED")
