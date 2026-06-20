#!/usr/bin/env python3
"""Smoke test for build_filter_complex delogo branches.

Validates that each method produces a syntactically plausible filter graph
AND that ffmpeg accepts the graph via a no-op real run (libavfilter level
parsing only — no decoding).
"""
import sys
import os
import json
import subprocess
import tempfile
from pathlib import Path

# Add python/ to path so we can import processor
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from processor import build_filter_complex  # noqa: E402

FFMPEG = HERE.parent / "bin" / "ffmpeg.exe"


def base_region():
    return {"x": 100, "y": 80, "w": 240, "h": 120}


def make_op(mode, **kwargs):
    return {"mode": "delogo", "region": base_region(),
            "delogo_method": mode, **kwargs}


def show(name, graph, label):
    print(f"\n=== {name} ===")
    print(f"--- filter complex ({label}) ---")
    print(graph)
    print(f"--- end ---")


def run_ffmpeg_parse(graph, out_label, images=None):
    """Feed the graph to ffmpeg's -filter_complex with a fakesrc, decode 1 frame
    to /dev/null. If the graph is invalid, ffmpeg errors out."""
    if not FFMPEG.exists():
        print(f"  (skip ffmpeg parse — ffmpeg not at {FFMPEG})")
        return True
    images = images or []
    cmd = [str(FFMPEG), "-y"]
    # Main video input (filter graph references it as [0:v])
    cmd += ["-f", "lavfi", "-i", "color=c=black:s=640x360:d=1:r=30"]
    # Cover/overlay images referenced by [1:v], [2:v], etc.
    for img in images:
        cmd += ["-loop", "1", "-i", str(img)]
    cmd += [
        "-filter_complex", graph,
        "-map", out_label,
        "-frames:v", "1",
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode == 0:
        print(f"  [OK] ffmpeg accepted graph")
        return True
    # Show relevant error lines
    err_lines = [
        l.strip() for l in proc.stderr.splitlines()
        if l.strip() and ("error" in l.lower() or "invalid" in l.lower()
                          or "undefined" in l.lower() or "could not" in l.lower())
    ]
    print(f"  [FAIL] ffmpeg rejected graph (rc={proc.returncode})")
    for l in err_lines[-5:]:
        print(f"    {l}")
    return False


def create_test_image(path):
    """Create a small PNG using ffmpeg lavfi so the cover method can load it."""
    if not FFMPEG.exists():
        return False
    cmd = [
        str(FFMPEG), "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1:r=1",
        "-frames:v", "1",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return proc.returncode == 0


CASES = [
    ("temporal default", [make_op("temporal")], 0),
    ("temporal radius 5", [make_op("temporal", temporal_radius=5)], 0),
    ("temporal + feather 0", [make_op("temporal", edge_feather=0)], 0),
    ("temporal + time range", [make_op("temporal", startTime=0.5, endTime=2.0)], 0),
    ("mosaic", [make_op("mosaic", mosaic_size=16)], 0),
    ("mirror right", [make_op("mirror", mirror_side="right")], 0),
    ("mirror left", [make_op("mirror", mirror_side="left")], 0),
    ("mirror top", [make_op("mirror", mirror_side="top")], 0),
    ("mirror bottom", [make_op("mirror", mirror_side="bottom")], 0),
    ("inpaint", [make_op("inpaint")], 0),
    ("blur", [make_op("blur", blur_strength=30)], 0),
    ("fill red", [make_op("fill", delogo_fill_color="red", delogo_fill_opacity=0.5)], 0),
    ("fill opacity 0", [make_op("fill", delogo_fill_color="red", delogo_fill_opacity=0)], 0),
    ("fill opacity clamped", [make_op("fill", delogo_fill_color="red", delogo_fill_opacity=-0.5)], 0),
    # Multiple ops chained (delogo + delogo)
    ("two temporal ops + feather", [
        make_op("temporal", edge_feather=10),
        make_op("temporal", edge_feather=10,
                region={"x": 400, "y": 200, "w": 100, "h": 80}),
    ], 0),
    # Mixed methods
    ("temporal + mosaic", [
        make_op("temporal", region={"x": 50, "y": 30, "w": 200, "h": 60}),
        make_op("mosaic", region={"x": 300, "y": 250, "w": 150, "h": 50}, mosaic_size=20),
    ], 0),
    # Degenerate region (should be skipped)
    ("zero-size region", [make_op("temporal", region={"x": 0, "y": 0, "w": 0, "h": 0})], 0),
    # Region at video edge
    ("edge region top-left", [make_op("temporal", region={"x": 0, "y": 0, "w": 100, "h": 60})], 0),
    # Region at video bottom-right corner
    ("edge region bottom-right", [make_op("mirror", region={"x": 540, "y": 300, "w": 100, "h": 60})], 0),
]


def main():
    temp_img = None
    try:
        # Create a temporary image for the cover method test.
        temp_img = Path(tempfile.gettempdir()) / "beru_test_cover.png"
        if create_test_image(temp_img):
            CASES.append(("cover with image", [make_op("cover", delogo_image_path=str(temp_img))], 0))
        else:
            print("  (skip cover case — ffmpeg not available to create test image)")

        passed = 0
        failed = 0
        for name, ops, _ in CASES:
            fc, label, _images = build_filter_complex(ops, 640, 360)
            # Some degenerate cases (zero-size region) intentionally return None.
            expect_none = (name == "zero-size region")
            if expect_none:
                if fc is None:
                    print(f"\n=== {name} ===\n  [OK] correctly skipped degenerate region")
                    passed += 1
                else:
                    print(f"\n=== {name} ===\n  [FAIL] expected None, got filter graph")
                    failed += 1
                continue
            if fc is None:
                print(f"\n=== {name} ===\n  [FAIL] returned None (no output)")
                failed += 1
                continue
            show(name, fc, label)
            ok = run_ffmpeg_parse(fc, label, _images)
            if ok:
                passed += 1
            else:
                failed += 1

        print(f"\n========\nPassed: {passed}\nFailed: {failed}\n========")
        return 0 if failed == 0 else 1
    finally:
        if temp_img and temp_img.exists():
            try:
                temp_img.unlink()
            except Exception:
                pass


def test_delogo_filter_graphs():
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
