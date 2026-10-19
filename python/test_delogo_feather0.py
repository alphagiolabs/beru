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
    assert "boxblur" not in chain, (
        f"feather=0 must not apply boxblur, but chain contains one: {chain!r}"
    )
    assert "overlay=" in chain and "enable=" in chain


def test_inpaint_feather0_no_time_no_boxblur():
    op = _op("inpaint", 0)
    chain = _build_delogo_chain(op, None, 0, 640, 480, None)
    assert chain is not None
    assert "boxblur" not in chain


def test_inpaint_feather6_with_time_applies_seamless_blend():
    op = _op("inpaint", 6, 5, 10)
    chain = _build_delogo_chain(op, None, 0, 640, 480, None)
    assert chain is not None
    assert "luma_radius=min(2" in chain
    assert "alphamerge" in chain
    assert "noise=alls=" not in chain
    assert "overlay=" in chain and "enable=" in chain


def test_mirror_without_source_falls_back_to_blur():
    op = _op("mirror", 0, 5, 10)
    op["region"] = {"x": 200, "y": 100, "w": 440, "h": 60}
    op["mirror_side"] = "right"
    chain = _build_delogo_chain(op, None, 0, 640, 480, None)
    assert chain is not None
    assert "boxblur=luma_radius=min(" in chain, (
        f"mirror with no source region must fall back to blur, got: {chain!r}"
    )
    assert "hflip" not in chain
    assert "enable=" in chain


def test_mosaic_feather0_patch_matches_selection_box():
    op = _op("mosaic", 0)
    chain = _build_delogo_chain(op, None, 0, 640, 480, None)
    assert chain is not None
    assert "crop=80:60:100:100" in chain
    assert "scale=84:64:flags=neighbor" not in chain, (
        f"mosaic patch exceeds the selection box: {chain!r}"
    )
    assert "scale=80:60:flags=neighbor" in chain
    assert "overlay=" in chain


if __name__ == "__main__":
    test_inpaint_feather0_with_time_no_boxblur()
    test_inpaint_feather0_no_time_no_boxblur()
    test_inpaint_feather6_with_time_applies_seamless_blend()
    test_mirror_without_source_falls_back_to_blur()
    test_mosaic_feather0_patch_matches_selection_box()
    print("OK: feather=0 with time bounds skips boxblur")
