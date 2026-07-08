#!/usr/bin/env python3
"""Watermark-only jobs must produce a filter graph (not a silent remux)."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from processor import build_filter_complex  # noqa: E402


def test_watermark_only_builds_drawtext_filter():
    wm = {
        "enabled": True,
        "type": "text",
        "text": "WM",
        "opacity": 0.5,
        "position": "bottom-right",
        "fontSize": 18,
        "fontColor": "white",
        "fontFamily": "Arial",
    }
    graph, label, paths = build_filter_complex([], 640, 360, watermark=wm)
    assert graph is not None
    assert "drawtext" in graph
    assert label is not None


def test_stream_copy_gate_requires_no_watermark():
    # Source contract: _process_one only stream-copies when ops empty AND no wm.
    src = (HERE / "processor.py").read_text(encoding="utf-8")
    assert "wm_enabled" in src
    assert "not raw_operations and not wm_enabled" in src


if __name__ == "__main__":
    test_watermark_only_builds_drawtext_filter()
    test_stream_copy_gate_requires_no_watermark()
    print("ALL PASSED")
