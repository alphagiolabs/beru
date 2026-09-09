"""Regression: when startTime >= endTime (empty/invalid range), the op must be
disabled — NOT applied for every t. Previously `_build_enable_clause` returned ""
for e<=s, which callers interpreted as "no time filter" → op applied always.
The fix: `build_filter_complex` skips the op entirely when the range is empty.

This test drives `build_filter_complex` with a text op where start=10, end=5
and asserts the resulting filter graph contains NO drawtext for that op.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from processor import build_filter_complex  # noqa: E402
from op_shared import _is_op_time_disabled  # noqa: E402


def _text_op(start, end):
    return {
        "mode": "text",
        "region": {"x": 10, "y": 10, "w": 100, "h": 40},
        "text": "HI",
        "fontSize": 24,
        "startTime": start,
        "endTime": end,
    }


def test_is_op_time_disabled_detects_empty_range():
    assert _is_op_time_disabled({"startTime": 10, "endTime": 5}) is True
    assert _is_op_time_disabled({"startTime": 5, "endTime": 5}) is True
    assert _is_op_time_disabled({"startTime": 5, "endTime": 10}) is False
    assert _is_op_time_disabled({"startTime": 5}) is False
    assert _is_op_time_disabled({"endTime": 10}) is False
    assert _is_op_time_disabled({}) is False


def test_build_filter_complex_skips_op_with_empty_time_range():
    op = _text_op(10, 5)  # end < start → empty range
    filter_str, _label, _paths = build_filter_complex([op], 320, 240)
    if filter_str is not None:
        assert "drawtext" not in filter_str, (
            f"Expected op to be skipped for empty time range, but filter contains drawtext: {filter_str!r}"
        )


def test_build_filter_complex_keeps_op_with_valid_range():
    op = _text_op(5, 10)  # valid range
    filter_str, _label, _paths = build_filter_complex([op], 320, 240)
    assert filter_str is not None, "Expected a filter for valid range"
    assert "drawtext" in filter_str, (
        f"Expected drawtext for valid range, got: {filter_str!r}"
    )


def test_build_filter_complex_keeps_op_without_time_bounds():
    op = _text_op(None, None)
    filter_str, _label, _paths = build_filter_complex([op], 320, 240)
    assert filter_str is not None, "Expected a filter for op without time bounds"
    assert "drawtext" in filter_str


def test_timed_blur_disables_the_expensive_blur_filter_outside_its_range():
    op = {
        "mode": "blur",
        "region": {"x": 10, "y": 10, "w": 100, "h": 40},
        "blur_strength": 20,
        "startTime": 5,
        "endTime": 10,
    }
    filter_str, _label, _paths = build_filter_complex([op], 320, 240)
    clause = r"enable=between(t\,5.000000\,10.000000)"
    assert "luma_radius=min(6" in filter_str
    assert f"chroma_power=1:{clause}" in filter_str
    assert f"overlay=10:10:{clause}" in filter_str


if __name__ == "__main__":
    test_is_op_time_disabled_detects_empty_range()
    test_build_filter_complex_skips_op_with_empty_time_range()
    test_build_filter_complex_keeps_op_with_valid_range()
    test_build_filter_complex_keeps_op_without_time_bounds()
    test_timed_blur_disables_the_expensive_blur_filter_outside_its_range()
    print("OK: empty time range disables op")
