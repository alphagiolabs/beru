#!/usr/bin/env python3
"""Permanent crop updates frame size and forces even dimensions."""
import sys
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from processor import build_filter_complex  # noqa: E402
from media_probe import find_ffmpeg  # noqa: E402

FFMPEG = find_ffmpeg()


def render(operations, size):
    graph, label, paths = build_filter_complex(operations, 640, 360)
    args = [FFMPEG, "-v", "error", "-f", "lavfi", "-i", "color=black:s=640x360:d=0.1"]
    for image_path in paths:
        args += ["-loop", "1", "-i", image_path]
    result = subprocess.run(
        args + ["-filter_complex", graph, "-map", label, "-frames:v", "1",
                "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
        capture_output=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    assert len(result.stdout) == size[0] * size[1] * 3
    return result.stdout


def visible_bounds(frame, width):
    points = [(i % width, i // width) for i in range(len(frame) // 3)
              if max(frame[3*i:3*i+3]) > 180]
    assert points, "Layer disappeared after crop"
    return min(x for x, _ in points), min(y for _, y in points)


def test_layers_keep_source_coordinates_after_crops():
    crop = {"mode": "crop", "region": {"x": 100, "y": 50, "w": 300, "h": 200}}
    text = {
        "mode": "text", "text": "WM", "font_size": 20, "bg_enabled": False,
        "region": {"x": 140, "y": 80, "w": 120, "h": 80},
    }
    for crops, size, expected in (
        ([crop], (300, 200), (40, 30)),
        ([crop, {"mode": "crop", "region": {"x": 120, "y": 60, "w": 200, "h": 100}}],
         (200, 100), (20, 20)),
        ([{"mode": "crop", "region": {"x": 101, "y": 51, "w": 300, "h": 200}}],
         (300, 200), (39, 29)),
        ([crop, {"mode": "crop", "region": {"x": 80, "y": 30, "w": 300, "h": 200}}],
         (280, 180), (40, 30)),
    ):
        x, y = visible_bounds(render([*crops, text], size), size[0])
        assert abs(x - expected[0]) <= 1 and y == expected[1], (x, y, expected)
    normalized = {**text, "region": {"x": 140/640, "y": 80/360, "w": 120/640, "h": 80/360}}
    x, y = visible_bounds(render([crop, normalized], (300, 200)), 300)
    assert abs(x - 40) <= 1 and y == 30, (x, y)
    fill = {
        "mode": "delogo", "delogo_method": "fill", "delogo_fill_color": "white",
        "edge_feather": 0, "region": {"x": 140, "y": 80, "w": 40, "h": 30},
    }
    assert visible_bounds(render([crop, fill], (300, 200)), 300) == (40, 30)
    with tempfile.TemporaryDirectory(prefix="beru-crop-image-") as directory:
        image_path = str(Path(directory) / "patch.png")
        result = subprocess.run(
            [FFMPEG, "-v", "error", "-f", "lavfi", "-i", "color=white:s=40x30",
             "-frames:v", "1", image_path], capture_output=True, timeout=30,
        )
        assert result.returncode == 0, result.stderr.decode(errors="replace")
        image = {"mode": "image", "image_path": image_path, "region": fill["region"]}
        assert visible_bounds(render([crop, image], (300, 200)), 300) == (40, 30)


def test_full_crop_even_dimensions():
    ops = [{"mode": "crop", "region": {"x": 0, "y": 0, "w": 101, "h": 51}}]
    graph, _label, _ = build_filter_complex(ops, 640, 360)
    assert graph is not None
    assert "crop=100:50:0:0" in graph


def test_full_crop_then_blur_uses_cropped_frame():
    ops = [
        {"mode": "crop", "region": {"x": 10, "y": 10, "w": 200, "h": 100}},
        {"mode": "blur", "region": {"x": 10, "y": 10, "w": 50, "h": 40}, "blur_strength": 20},
    ]
    graph, _label, _ = build_filter_complex(ops, 640, 360)
    assert graph is not None
    assert "crop=200:100:10:10" in graph or "crop=200:100:" in graph
    assert "crop=50:40:0:0" in graph


if __name__ == "__main__":
    test_full_crop_even_dimensions()
    test_full_crop_then_blur_uses_cropped_frame()
    test_layers_keep_source_coordinates_after_crops()
    print("ALL PASSED")
