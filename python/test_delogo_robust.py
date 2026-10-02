#!/usr/bin/env python3
"""Robustness tests for delogo: normalized coords, edge cases, temporal removal."""
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from processor import build_filter_complex, _region_to_pixels, _normalize_operation, find_ffmpeg  # noqa: E402
from delogo_chains import _build_delogo_chain  # noqa: E402

FFMPEG = Path(find_ffmpeg())


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120)


def assert_graph(ops, vw, vh, label=""):
    fc, out, _ = build_filter_complex(ops, vw, vh)
    assert fc is not None, f"{label}: graph is None"
    assert FFMPEG.exists(), f"ffmpeg not found at {FFMPEG}"
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
    assert "boxblur" in fc, "unknown method should fall back to blur"


def test_feather_zero():
    op = {
        "mode": "delogo",
        "region": {"x": 20, "y": 20, "w": 60, "h": 40},
        "delogo_method": "temporal",
        "edge_feather": 0,
    }
    fc, _, _ = build_filter_complex([op], 320, 180)
    assert "boxblur" not in fc, f"feather=0 must not inject a blur, got: {fc}"


def test_small_blur_region_max_strength():
    op = {
        "mode": "delogo",
        "region": {"x": 0, "y": 0, "w": 20, "h": 10},
        "delogo_method": "blur",
        "blur_strength": 100,
        "edge_feather": 0,
    }
    assert_graph([op], 320, 180, "small max-strength blur")


def test_small_blur_tool_max_strength():
    op = {
        "mode": "blur",
        "region": {"x": 0, "y": 0, "w": 20, "h": 10},
        "blur_strength": 100,
    }
    assert_graph([op], 320, 180, "small max-strength blur tool")


def test_small_blur_region_max_feather():
    op = {
        "mode": "delogo",
        "region": {"x": 0, "y": 0, "w": 20, "h": 10},
        "delogo_method": "blur",
        "blur_strength": 12,
        "edge_feather": 40,
    }
    assert_graph([op], 320, 180, "small max-feather blur")


def test_corner_region():
    op = {
        "mode": "delogo",
        "region": {"x": 0.85, "y": 0.9, "w": 0.12, "h": 0.08},
        "delogo_method": "inpaint",
        "edge_feather": 0,
    }
    assert_graph([op], 1920, 1080, "corner inpaint")


def test_edge_blur_preserves_the_full_selection():
    op = {
        "mode": "delogo",
        "region": {"x": 0, "y": 0, "w": 101, "h": 61},
        "delogo_method": "blur",
        "blur_strength": 30,
        "edge_feather": 0,
    }
    fc, _, _ = build_filter_complex([op], 320, 180)
    assert "crop=101:61:0:0" in fc, f"edge selection was silently inset: {fc}"
    assert "overlay=0:0" in fc
    assert_graph([op], 320, 180, "edge blur preserves selection")


def test_edge_inpaint_falls_back_to_blur_without_leaving_a_border():
    op = {
        "mode": "delogo",
        "region": {"x": 0, "y": 0, "w": 100, "h": 60},
        "delogo_method": "inpaint",
        "edge_feather": 0,
    }
    fc, _, _ = build_filter_complex([op], 320, 180)
    assert "delogo=x=" not in fc, f"native delogo cannot interpolate at a frame edge: {fc}"
    assert "crop=100:60:0:0" in fc, f"fallback did not keep the selected border: {fc}"
    assert "boxblur=" in fc
    assert_graph([op], 320, 180, "edge inpaint blur fallback")


def test_interior_inpaint_preserves_odd_selection_dimensions():
    op = {
        "mode": "delogo",
        "region": {"x": 10, "y": 10, "w": 31, "h": 17},
        "delogo_method": "inpaint",
        "edge_feather": 0,
    }
    fc, _, _ = build_filter_complex([op], 320, 180)
    assert "delogo=x=10:y=10:w=31:h=17" in fc, f"valid odd selection was resized: {fc}"
    assert_graph([op], 320, 180, "odd inpaint selection")


def test_fill_opacity_zero_preserved():
    op = {"mode": "delogo", "region": {"x": 10, "y": 10, "w": 80, "h": 40},
          "delogo_method": "fill", "delogo_fill_color": "red",
          "delogo_fill_opacity": 0}
    fc, _, _ = build_filter_complex([op], 320, 180)
    assert "color=red@0.0:" in fc, f"opacity 0 not preserved in filter: {fc}"


def test_fill_opacity_out_of_range_clamped():
    op = {"mode": "delogo", "region": {"x": 10, "y": 10, "w": 80, "h": 40},
          "delogo_method": "fill", "delogo_fill_color": "red",
          "delogo_fill_opacity": 2.5}
    fc, _, _ = build_filter_complex([op], 320, 180)
    assert "color=red@1.0:" in fc, f"opacity not clamped to 1: {fc}"


def test_image_opacity_zero_preserved():
    op = {"mode": "image", "region": {"x": 10, "y": 10, "w": 80, "h": 40},
          "image_path": __file__, "image_opacity": 0}
    fc, _, _ = build_filter_complex([op], 320, 180)
    assert "colorchannelmixer=aa=0.000" in fc, f"image opacity 0 not preserved: {fc}"


def test_cover_keeps_contain_letterbox_transparent():
    assert FFMPEG.exists(), f"ffmpeg not found at {FFMPEG}"
    with tempfile.TemporaryDirectory(prefix="beru_delogo_cover_") as tmp_dir:
        tmp = Path(tmp_dir)
        cover = tmp / "cover.ppm"
        output = tmp / "output.ppm"
        generated = run([
            str(FFMPEG), "-y", "-f", "lavfi", "-i",
            "color=c=red:s=200x100:d=1", "-frames:v", "1", str(cover),
        ])
        assert generated.returncode == 0, generated.stderr[-400:]

        op = {
            "mode": "delogo",
            "region": {"x": 50, "y": 30, "w": 100, "h": 100},
            "delogo_method": "cover",
            "delogo_image_path": str(cover),
            "edge_feather": 0,
        }
        fc, label, images = build_filter_complex([op], 320, 180)
        assert images == [str(cover)]
        rendered = run([
            str(FFMPEG), "-y", "-f", "lavfi", "-i",
            "color=c=blue:s=320x180:d=1:r=1", "-loop", "1", "-i", str(cover),
            "-filter_complex", fc, "-map", label, "-frames:v", "1",
            "-pix_fmt", "rgb24", str(output),
        ])
        assert rendered.returncode == 0, rendered.stderr[-400:]

        data = output.read_bytes()
        header_end = data.find(b"\n255\n")
        assert header_end >= 0, "invalid PPM output"
        pixels = data[header_end + 5:]

        def pixel(x, y):
            offset = (y * 320 + x) * 3
            return tuple(pixels[offset:offset + 3])

        padding = pixel(55, 35)
        content = pixel(100, 80)
        assert padding[2] > 200 and padding[0] < 30, (
            f"cover contain padding must reveal the video, got {padding}"
        )
        assert content[0] > 200 and content[2] < 30, (
            f"cover image did not render inside the selection, got {content}"
        )


def test_delogo_color_injection_rejected():
    op = {"mode": "delogo", "region": {"x": 10, "y": 10, "w": 80, "h": 40},
          "delogo_method": "fill",
          "delogo_fill_color": "red:t=fill,drawtext=text=owned"}
    try:
        _build_delogo_chain(op, None, 0, 320, 180)
    except ValueError:
        return
    raise AssertionError("injected fill color was not rejected")


def test_temporal_removes_static_logo():
    assert FFMPEG.exists(), f"ffmpeg not found at {FFMPEG}"
    tmp_holder = tempfile.TemporaryDirectory(prefix="beru_delogo_robust_")
    tmp = Path(tmp_holder.name)
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
        test_small_blur_region_max_strength,
        test_small_blur_tool_max_strength,
        test_small_blur_region_max_feather,
        test_corner_region,
        test_edge_blur_preserves_the_full_selection,
        test_edge_inpaint_falls_back_to_blur_without_leaving_a_border,
        test_interior_inpaint_preserves_odd_selection_dimensions,
        test_fill_opacity_zero_preserved,
        test_fill_opacity_out_of_range_clamped,
        test_image_opacity_zero_preserved,
        test_cover_keeps_contain_letterbox_transparent,
        test_delogo_color_injection_rejected,
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
