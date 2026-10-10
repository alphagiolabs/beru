"""Unit tests for letter-spacing layout helpers (positive + negative)."""

from text_layout_helpers import (
    _apply_letter_spacing_fallback,
    _text_glyph_positions,
)


def test_negative_fallback_is_noop_on_text():
    assert _apply_letter_spacing_fallback("AB", -2, 32) == "AB"


def test_glyph_positions_tighten_with_negative_spacing():
    normal = _text_glyph_positions("ABC", 0, 32)
    tight = _text_glyph_positions("ABC", -4, 32)
    assert len(normal) == 3 and len(tight) == 3
    assert normal[0][1] == tight[0][1] == 0.0
    assert tight[1][1] < normal[1][1]
    assert tight[2][1] < normal[2][1]
    assert [g[0] for g in tight] == ["A", "B", "C"]


def test_glyph_positions_center_align():
    glyphs = _text_glyph_positions(
        "AB",
        -2,
        20,
        region_w=200,
        text_align="center",
    )
    assert len(glyphs) == 2
    assert glyphs[0][1] > 0


if __name__ == "__main__":
    test_negative_fallback_is_noop_on_text()
    test_glyph_positions_tighten_with_negative_spacing()
    test_glyph_positions_center_align()
    print("OK: letter spacing helpers")
