#!/usr/bin/env python3
"""Geometry contract: the shared cases with the JS helper, and the copy-path rule."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from frame_geometry import is_identity_transform, normalize_transform, output_dimensions  # noqa: E402
from job_classify import _job_takes_copy_path  # noqa: E402

CASES = json.loads((HERE.parent / "tests" / "fixtures" / "output-geometry-cases.json").read_text(encoding="utf-8"))


def job_from_case(transform):
    return {
        "rotation": transform["rotation"],
        "flip_h": transform["flipH"],
        "flip_v": transform["flipV"],
        "output_height": transform["outputHeight"],
    }


def test_shared_cases_match_the_javascript_helper():
    for case in CASES["cases"]:
        width, height, resized = output_dimensions(
            case["frame"]["width"], case["frame"]["height"],
            normalize_transform(job_from_case(case["transform"])),
        )
        assert {"width": width, "height": height, "resized": resized} == case["expect"], case


def test_invalid_values_fall_back_to_identity():
    assert is_identity_transform(normalize_transform({"rotation": 45, "output_height": -4, "flip_h": "yes"}))
    for rotation in (90.5, "90.5", float("inf"), float("nan")):
        assert normalize_transform({"rotation": rotation})["rotation"] == 0, rotation
    assert is_identity_transform(normalize_transform({}))
    assert is_identity_transform(normalize_transform(None))


def test_any_geometry_change_leaves_the_stream_copy_path():
    base = {"operations": [], "input_path": "a.mp4"}
    assert _job_takes_copy_path(base)
    assert not _job_takes_copy_path({**base, "rotation": 90})
    assert not _job_takes_copy_path({**base, "flip_v": True})
    assert not _job_takes_copy_path({**base, "output_height": 480})
    assert _job_takes_copy_path({**base, "rotation": 0, "flip_h": False, "output_height": None})


if __name__ == "__main__":
    test_shared_cases_match_the_javascript_helper()
    test_invalid_values_fall_back_to_identity()
    test_any_geometry_change_leaves_the_stream_copy_path()
    print("frame geometry: all checks passed")
