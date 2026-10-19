#!/usr/bin/env python3
"""Geometry contract: shared layout cases with the JS helper and invalid inputs."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from frame_geometry import (  # noqa: E402
    is_identity_transform,
    normalize_transform,
    output_layout,
)

CASES = json.loads((HERE.parent / "tests" / "fixtures" / "output-geometry-cases.json").read_text(encoding="utf-8"))


def job_from_case(transform):
    return {
        "rotation": transform["rotation"],
        "flip_h": transform["flipH"],
        "flip_v": transform["flipV"],
        "output_height": transform["outputHeight"],
        "output_width": transform.get("outputWidth"),
        "fit_mode": transform.get("fitMode"),
    }


def test_shared_layout_cases_match_the_javascript_helper():
    for case in CASES["layout_cases"]:
        width, height, resized, content = output_layout(
            case["frame"]["width"], case["frame"]["height"],
            normalize_transform(job_from_case(case["transform"])))
        assert {"width": width, "height": height, "resized": resized,
                "content": content} == case["expect"], case


def test_shared_cases_match_the_javascript_helper():
    for case in CASES["cases"]:
        width, height, resized = output_layout(
            case["frame"]["width"], case["frame"]["height"],
            normalize_transform(job_from_case(case["transform"])),
        )[:3]
        assert {"width": width, "height": height, "resized": resized} == case["expect"], case


def test_invalid_values_fall_back_to_identity():
    assert is_identity_transform(normalize_transform({"rotation": 45, "output_height": -4, "flip_h": "yes"}))
    for rotation in (90.5, "90.5", float("inf"), float("nan")):
        assert normalize_transform({"rotation": rotation})["rotation"] == 0, rotation
    assert is_identity_transform(normalize_transform({}))
    assert is_identity_transform(normalize_transform(None))


if __name__ == "__main__":
    test_shared_cases_match_the_javascript_helper()
    test_shared_layout_cases_match_the_javascript_helper()
    test_invalid_values_fall_back_to_identity()
    print("frame geometry: all checks passed")
