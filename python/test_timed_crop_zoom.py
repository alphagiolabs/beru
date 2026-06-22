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
    # The crop must be scaled to the FULL video size (640:480), not its own
    # 200:150. The no-op bug scaled to 200:150.
    assert "scale=640:480" in filter_str, (
        f"Expected timed crop to zoom to full frame (640:480), got: {filter_str!r}"
    )
    # And overlaid at 0:0, not at the crop's x:y (100:100)
    assert "overlay=0:0" in filter_str, (
        f"Expected overlay at 0:0 for zoom, got: {filter_str!r}"
    )


def test_full_duration_crop_still_changes_resolution():
    op = _crop_op(None, None)
    filter_str, _label, _paths = build_filter_complex([op], 640, 480)
    assert filter_str is not None
    # Full-duration crop: just crop, no split/overlay
    assert "crop=200:150:100:100" in filter_str
    assert "split" not in filter_str, (
        f"Full-duration crop must not split, got: {filter_str!r}"
    )


if __name__ == "__main__":
    test_timed_crop_scales_to_full_frame()
    test_full_duration_crop_still_changes_resolution()
    print("OK: timed crop is a zoom (scales to full frame)")
