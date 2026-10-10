"""Regression: time-bounded crop was a visual no-op — the cropped region was
scaled back to its own w:h and overlaid at x:y, pasting it on its own pixels.
The fix: time-bounded crop is a ZOOM — the crop is scaled to video_w:video_h
and overlaid at 0:0, so during [start,end] the cropped region fills the frame.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from processor import build_filter_complex  # noqa: E402


def _crop_op(start, end):
    return {
        "mode": "crop",
        "region": {"x": 100, "y": 100, "w": 200, "h": 150},
        "startTime": start,
        "endTime": end,
    }


def test_timed_crop_scales_to_full_frame():
    op = _crop_op(5, 10)
    filter_str, _label, _paths = build_filter_complex([op], 640, 480)
    assert filter_str is not None, "Expected a filter for timed crop"
    assert "scale=640:480" in filter_str, (
        f"Expected timed crop to zoom to full frame (640:480), got: {filter_str!r}"
    )
    assert "overlay=0:0" in filter_str, (
        f"Expected overlay at 0:0 for zoom, got: {filter_str!r}"
    )


if __name__ == "__main__":
    test_timed_crop_scales_to_full_frame()
    print("OK: timed crop is a zoom (scales to full frame)")
