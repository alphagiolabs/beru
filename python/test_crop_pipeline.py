#!/usr/bin/env python3
"""Permanent crop updates frame size and forces even dimensions."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from processor import build_filter_complex  # noqa: E402


def test_full_crop_even_dimensions():
    ops = [{"mode": "crop", "region": {"x": 0, "y": 0, "w": 101, "h": 51}}]
    graph, label, _ = build_filter_complex(ops, 640, 360)
    assert graph is not None
    # 101→100, 51→50
    assert "crop=100:50:0:0" in graph


def test_full_crop_then_blur_uses_cropped_frame():
    ops = [
        {"mode": "crop", "region": {"x": 10, "y": 10, "w": 200, "h": 100}},
        {"mode": "blur", "region": {"x": 0, "y": 0, "w": 50, "h": 40}, "blur_strength": 20},
    ]
    graph, label, _ = build_filter_complex(ops, 640, 360)
    assert graph is not None
    assert "crop=200:100:10:10" in graph or "crop=200:100:" in graph
    # Blur crop should not exceed the post-crop frame (200x100)
    assert "crop=50:40:0:0" in graph


if __name__ == "__main__":
    test_full_crop_even_dimensions()
    test_full_crop_then_blur_uses_cropped_frame()
    print("ALL PASSED")
