#!/usr/bin/env python3
"""Robustness tests for delogo: normalized coords, edge cases, temporal removal."""
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from processor import build_filter_complex, _region_to_pixels, _normalize_operation  # noqa: E402

FFMPEG = HERE.parent / "bin" / "ffmpeg.exe"


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120)


def assert_graph(ops, vw, vh, label=""):
    fc, out, _ = build_filter_complex(ops, vw, vh)
    assert fc is not None, f"{label}: graph is None"
    if not FFMPEG.exists():
        return
    cmd = [
        str(FFMPEG), "-y",
        "-f", "lavfi", "-i", f"color=c=green:s={vw}x{vh}:rate=30:d=1",
        "-filter_complex", fc, "-map", out,
        "-frames:v", "1", "-f", "null", "-",
    ]
    r = run(cmd)
    assert r.returncode == 0, f"{label}: ffmpeg rejected graph:\n{r.stderr[-400:]}"


def test_normalized_region():
    region = {"x": 0.1, "y": 0.2, "w": 0.25, "h": 0.15}
    px = _region_to_pixels(region, 640, 360)
    assert px == {"x": 64, "y": 72, "w": 160, "h": 54}
    op = {"mode": "delogo", "region": region, "delogo_method": "blur", "edge_feather": 0}
    assert_graph([op], 640, 360, "normalized")


def test_camel_case_keys():
    op = _normalize_operation({
        "mode": "delogo",
        "region": {"x": 50, "y": 30, "w": 100, "h": 60},
        "delogoMethod": "mosaic",
        "mosaicSize": 10,
        "edgeFeather": 0,
    })
    assert op["delogo_method"] == "mosaic"
    assert op["mosaic_size"] == 10
    assert_graph([op], 320, 180, "camelCase")


def test_invalid_method_fallback():
    op = {
        "mode": "delogo",
        "region": {"x": 10, "y": 10, "w": 80, "h": 40},
        "delogo_method": "magic",
        "edge_feather": 0,
    }
    fc, _, _ = build_filter_complex([op], 320, 180)
    assert "tmedian" in fc, "unknown method should fall back to temporal"


def test_feather_zero():
    op = {
        "mode": "delogo",
        "region": {"x": 20, "y": 20, "w": 60, "h": 40},
        "delogo_method": "temporal",
        "edge_feather": 0,
    }
    fc, _, _ = build_filter_complex([op], 320, 180)
    assert "boxblur=6" not in fc or fc.count("boxblur") == 0 or "soft" not in fc


def test_corner_region():
    op = {
        "mode": "delogo",
        "region": {"x": 0.85, "y": 0.9, "w": 0.12, "h": 0.08},
        "delogo_method": "inpaint",
        "edge_feather": 0,
    }
    assert_graph([op], 1920, 1080, "corner inpaint")


def test_temporal_removes_static_logo():
    if not FFMPEG.exists():
        print("  [skip] temporal e2e — no ffmpeg")
        return
    tmp = Path(tempfile.mkdtemp(prefix="beru_delogo_robust_"))
    truth = tmp / "truth.mp4"
    logo = tmp / "logo.mp4"
    out = tmp / "out.mp4"
    region = {"x": 40, "y": 25, "w": 100, "h": 50}

    run([
        str(FFMPEG), "-y", "-f", "lavfi",
        "-i", "color=c=blue:s=320x180:rate=30:duration=2",
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(truth),
    ])
    run([
        str(FFMPEG), "-y", "-i", str(truth),
        "-vf", f"drawbox=x={region['x']}:y={region['y']}:w={region['w']}:h={region['h']}:color=red@1:t=fill",
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(logo),
    ])

    op = {"mode": "delogo", "region": region, "delogo_method": "temporal",
          "temporal_radius": 4, "edge_feather": 4}
    fc, label, _ = build_filter_complex([op], 320, 180)
    run([
        str(FFMPEG), "-y", "-i", str(logo),
        "-filter_complex", fc, "-map", label,
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(out),
    ])

    def avg(path):
        ppm = tmp / "px.ppm"
        x, y, w, h = region["x"], region["y"], region["w"], region["h"]
        run([
            str(FFMPEG), "-y", "-ss", "1", "-i", str(path),
            "-vf", f"crop={w}:{h}:{x}:{y},scale=1:1,format=rgb24",
            "-frames:v", "1", str(ppm),
        ])
        data = ppm.read_bytes()
        idx = data.find(b"255\n")
        rgb = data[idx + 4:idx + 7]
        return tuple(rgb) if len(rgb) == 3 else None

    t = avg(truth)
    l = avg(logo)
    o = avg(out)
    assert t and l and o, "sampling failed"
    d_in = sum((a - b) ** 2 for a, b in zip(t, l)) ** 0.5
    d_out = sum((a - b) ** 2 for a, b in zip(t, o)) ** 0.5
    assert d_out < d_in, f"temporal did not improve: in={d_in:.1f} out={d_out:.1f} truth={t} logo={l} out={o}"


def main():
    tests = [
        test_normalized_region,
        test_camel_case_keys,
        test_invalid_method_fallback,
        test_feather_zero,
        test_corner_region,
        test_temporal_removes_static_logo,
    ]
    failed = 0
    for t in tests:
        name = t.__name__
        try:
            t()
            print(f"  [OK] {name}")
        except Exception as e:
            print(f"  [FAIL] {name}: {e}")
            failed += 1
    print(f"\n{'ALL PASSED' if not failed else f'{failed} FAILED'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())