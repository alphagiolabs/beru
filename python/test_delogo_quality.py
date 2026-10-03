"""Pixel regressions for logo contamination, flicker and blur context."""

import subprocess
import tempfile
from pathlib import Path

import numpy as np

from processor import build_filter_complex, find_ffmpeg

FFMPEG = find_ffmpeg()
WIDTH, HEIGHT, FRAMES = 320, 180, 12


def run(*args):
    result = subprocess.run([str(arg) for arg in args], capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr.decode(errors="replace")[-2000:]
    return result.stdout


def source(folder, name, filters, pixel_format="yuv420p"):
    path = folder / f"{name}.mkv"
    run(FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", filters,
        "-frames:v", FRAMES, "-pix_fmt", pixel_format, "-c:v", "ffv1", path)
    return path


def render(path, operation):
    graph, label, _ = build_filter_complex([operation], WIDTH, HEIGHT)
    data = run(FFMPEG, "-v", "error", "-i", path,
               "-filter_complex", graph, "-map", label,
               "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
    frames = np.frombuffer(data, np.uint8).reshape(-1, HEIGHT, WIDTH, 3)
    assert len(frames) == FRAMES, f"Frame count changed: {len(frames)}"
    return frames.astype(float)


def test_inpaint_does_not_invent_flicker(folder):
    path = source(folder, "still", "color=c=0x808080:s=320x180:r=12,"
                  "drawbox=x=108:y=68:w=24:h=14:color=white:t=fill")
    frames = render(path, {"mode": "delogo", "delogo_method": "inpaint",
                           "region": {"x": 104, "y": 64, "w": 32, "h": 22},
                           "edge_feather": 6})
    flicker = np.abs(np.diff(frames[:, 64:86, 104:136], axis=0)).mean()
    print(f"static inpaint temporal MAE: {flicker:.4f}")
    assert flicker == 0, f"A still background acquired flicker: {flicker:.4f}"


def test_inpaint_replaces_tight_odd_logo(folder):
    path = source(folder, "tight", "color=c=0x808080:s=320x180:r=12,"
                  "drawbox=x=101:y=61:w=33:h=21:color=white:t=fill")
    frames = render(path, {"mode": "delogo", "delogo_method": "inpaint",
                           "region": {"x": 101, "y": 61, "w": 33, "h": 21},
                           "edge_feather": 6})
    reference = frames[:, 120:140, 20:40].mean(axis=(1, 2), keepdims=True)
    error = np.abs(frames[:, 61:82, 101:134] - reference).mean()
    print(f"tight odd logo RGB MAE: {error:.4f}")
    assert error <= 2, f"Logo pixels contaminated the reconstruction: {error:.4f}"


def test_blur_has_full_kernel_context(folder):
    path = source(folder, "texture", "testsrc2=s=320x180:r=12")
    # A whole-frame blur has all the context a local implementation must sample.
    data = run(FFMPEG, "-v", "error", "-i", path, "-vf",
               "boxblur=luma_radius=20:luma_power=3:chroma_radius=10:chroma_power=3",
               "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
    expected = np.frombuffer(data, np.uint8).reshape(-1, HEIGHT, WIDTH, 3).astype(float)
    for x in (51, 101):
        box = {"x": x, "y": 61, "w": 33, "h": 21}
        for mode in ("delogo", "blur"):
            actual = render(path, {"mode": mode, "delogo_method": "blur",
                                   "region": box, "edge_feather": 0, "blur_strength": 60})
            error = np.abs(actual[:, 63:80, x+2:x+31] - expected[:, 63:80, x+2:x+31]).mean()
            print(f"{mode} local/full blur RGB MAE at x={x}: {error:.4f}")
            assert error <= 2, f"Crop reflection, color loss or radius clipping biased the blur: {error:.4f}"


def test_inpaint_keeps_unselected_high_depth_pixels(folder):
    path = source(folder, "high_depth", "testsrc2=s=320x180:r=12", "yuv444p10le")
    op = {"mode": "delogo", "delogo_method": "inpaint",
          "region": {"x": 101, "y": 61, "w": 33, "h": 21}, "edge_feather": 6}
    graph, label, _ = build_filter_complex([op], WIDTH, HEIGHT, source_pix_fmt="yuv444p10le")
    args = ("-pix_fmt", "yuv444p10le", "-f", "rawvideo", "pipe:1")
    reference = run(FFMPEG, "-v", "error", "-i", path, *args)
    output = run(FFMPEG, "-v", "error", "-i", path,
                 "-filter_complex", graph, "-map", label, *args)
    expected = np.frombuffer(reference, "<u2").reshape(FRAMES, 3, HEIGHT, WIDTH)
    actual = np.frombuffer(output, "<u2").reshape(FRAMES, 3, HEIGHT, WIDTH)
    untouched = np.ones((HEIGHT, WIDTH), bool)
    untouched[50:95, 90:145] = False
    changed = np.count_nonzero(actual[:, :, untouched] != expected[:, :, untouched])
    print(f"high-depth pixels changed outside effect: {changed}")
    assert changed == 0, "Logo compositing degraded unselected 10-bit/chroma detail"


if __name__ == "__main__":
    failures = []
    with tempfile.TemporaryDirectory(prefix="beru_delogo_quality_") as temp:
        for test in (test_inpaint_does_not_invent_flicker,
                     test_inpaint_replaces_tight_odd_logo,
                     test_blur_has_full_kernel_context,
                     test_inpaint_keeps_unselected_high_depth_pixels):
            try:
                test(Path(temp))
                print(f"[ok] {test.__name__}")
            except AssertionError as exc:
                failures.append(str(exc))
                print(f"[FAIL] {test.__name__}: {exc}")
    raise SystemExit(bool(failures))
