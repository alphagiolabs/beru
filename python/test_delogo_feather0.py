"""Regression: delogo inpaint with feather=0 and a time range (enable_clause)
applied boxblur=max(1,0)=1, subtly blurring the patch the user explicitly
asked to keep sharp. The fix: when feather<=0, skip boxblur even with
enable_clause — overlay the clean patch directly.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from delogo_chains import _build_delogo_chain  # noqa: E402


def _op(method, feather, start=None, end=None):
    op = {
        "mode": "delogo",
        "delogo_method": method,
        "region": {"x": 100, "y": 100, "w": 80, "h": 60},
        "edge_feather": feather,
    }
    if start is not None:
        op["startTime"] = start
    if end is not None:
        op["endTime"] = end
    return op


def test_inpaint_feather0_with_time_no_boxblur():
    op = _op("inpaint", 0, 5, 10)
    chain = _build_delogo_chain(op, None, 0, 640, 480, None)
    assert chain is not None
    assert "boxblur=1" not in chain, (
        f"feather=0 must not apply boxblur, but chain contains boxblur=1: {chain!r}"
    )
    assert "overlay=" in chain


def test_inpaint_feather0_no_time_no_boxblur():
    op = _op("inpaint", 0)
    chain = _build_delogo_chain(op, None, 0, 640, 480, None)
    assert chain is not None
    assert "boxblur" not in chain


def test_inpaint_feather6_with_time_applies_seamless_blend():
    op = _op("inpaint", 6, 5, 10)
    chain = _build_delogo_chain(op, None, 0, 640, 480, None)
    assert chain is not None
    assert "luma_radius=min(6" in chain
    assert "alphamerge" in chain
    assert "noise=alls=" in chain
    assert "overlay=" in chain and "enable=" in chain


def test_mirror_fallback_feather0_with_time_no_boxblur():
    op = _op("mirror", 0, 5, 10)
    op["region"] = {"x": 600, "y": 100, "w": 80, "h": 60}  # flush at right edge of 640
    op["mirror_side"] = "right"
    chain = _build_delogo_chain(op, None, 0, 640, 480, None)
    assert chain is not None
    assert "boxblur=1" not in chain, (
        f"feather=0 fallback must not apply boxblur=1, got: {chain!r}"
    )


if __name__ == "__main__":
    test_inpaint_feather0_with_time_no_boxblur()
    test_inpaint_feather0_no_time_no_boxblur()
    test_inpaint_feather6_with_time_applies_seamless_blend()
    test_mirror_fallback_feather0_with_time_no_boxblur()
    print("OK: feather=0 with time bounds skips boxblur")
