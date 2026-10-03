"""Lossless exact-preview transport, including source precision and crop size."""

import base64
import subprocess
import tempfile
from pathlib import Path

import processor
from processor import render_preview_frame, render_source_frame


FFMPEG = processor.find_ffmpeg()
processor.FFMPEG = FFMPEG
processor.FFPROBE = processor.find_ffprobe(FFMPEG)


def run(*args, data=None):
    result = subprocess.run([str(arg) for arg in (FFMPEG, "-v", "error", *args)],
                            input=data, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    return result.stdout


def test_preview_preserves_high_depth(folder):
    source = folder / "gradient10.mkv"
    run("-y", "-f", "lavfi", "-i",
        "nullsrc=s=512x288:r=1,format=yuv444p10le,geq=lum='64+876*X/W':cb=512:cr=512",
        "-frames:v", "1", "-c:v", "ffv1", source)
    payload = {"input_path": str(source), "timestamp": 0, "operations": []}
    expected = run("-i", source, "-frames:v", "1", "-pix_fmt", "rgb48be",
                   "-f", "rawvideo", "pipe:1")
    for render in (render_preview_frame, render_source_frame):
        result = render(payload)
        assert result["ok"], result
        assert result["data_url"].startswith("data:image/png;base64,"), "Lossy image transport"
        image = base64.b64decode(result["data_url"].split(",", 1)[1])
        assert image[24] == 16, "Native precision was quantized to eight bits"
        actual = run("-f", "image2pipe", "-i", "pipe:0", "-pix_fmt", "rgb48be",
                     "-f", "rawvideo", "pipe:1", data=image)
        assert actual == expected, "Preview transport altered decoded source pixels"


def test_preview_reports_actual_crop_size(folder):
    source = folder / "color.mkv"
    run("-y", "-f", "lavfi", "-i", "testsrc2=s=160x120:r=1",
        "-frames:v", "1", "-c:v", "ffv1", source)
    op = {"mode": "crop", "region": {"x": 20, "y": 20, "w": 80, "h": 60}}
    result = render_preview_frame({"input_path": str(source), "timestamp": 0,
                                   "operations": [op]})
    assert result["ok"], result
    assert (result["width"], result["height"]) == (80, 60), result
    image = base64.b64decode(result["data_url"].split(",", 1)[1])
    actual = run("-f", "image2pipe", "-i", "pipe:0", "-pix_fmt", "rgb48be",
                 "-f", "rawvideo", "pipe:1", data=image)
    expected = run("-i", source, "-vf", "crop=80:60:20:20", "-pix_fmt", "rgb48be",
                   "-f", "rawvideo", "pipe:1")
    assert actual == expected, "Exact preview added chroma or compression errors"


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="beru_preview_quality_") as temp:
        test_preview_preserves_high_depth(Path(temp))
        test_preview_reports_actual_crop_size(Path(temp))
    print("PNG preview: high-depth pixels and crop geometry preserved")
