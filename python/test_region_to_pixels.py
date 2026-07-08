#!/usr/bin/env python3
"""Tests for _region_to_pixels normalized vs pixel heuristics."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from op_shared import _region_to_pixels  # noqa: E402


def test_fractional_normalized_region():
    r = _region_to_pixels({"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}, 1000, 500)
    assert r == {"x": 100, "y": 100, "w": 300, "h": 200}


def test_one_by_one_pixel_is_not_full_frame():
    # Electron denormalizes; a 1×1 box must stay 1×1, not expand to full frame.
    r = _region_to_pixels({"x": 0, "y": 0, "w": 1, "h": 1}, 1920, 1080)
    assert r == {"x": 0, "y": 0, "w": 1, "h": 1}


def test_large_pixel_region():
    r = _region_to_pixels({"x": 10, "y": 20, "w": 100, "h": 50}, 1920, 1080)
    assert r == {"x": 10, "y": 20, "w": 100, "h": 50}


def test_full_width_fraction_height_normalized():
    r = _region_to_pixels({"x": 0, "y": 0, "w": 1, "h": 0.25}, 800, 400)
    assert r["w"] == 800
    assert r["h"] == 100


if __name__ == "__main__":
    test_fractional_normalized_region()
    test_one_by_one_pixel_is_not_full_frame()
    test_large_pixel_region()
    test_full_width_fraction_height_normalized()
    print("ALL PASSED")
