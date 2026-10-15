import subprocess
from pathlib import Path

from frame_geometry import normalize_transform
from processor import build_filter_complex

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = str(ROOT / "bin" / "ffmpeg.exe")


def render(graph, label, width, height, color="0x808080"):
    source = f"color=c={color}:s={width}x{height}:d=1:r=1"
    cmd = [FFMPEG, "-v", "error", "-f", "lavfi", "-i", source]
    if graph:
        cmd += ["-filter_complex", graph, "-map", label]
    cmd += ["-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    return result.stdout


def pixel(frame, width, x, y):
    offset = (y * width + x) * 3
    return tuple(frame[offset:offset + 3])


def transform(**fields):
    return normalize_transform({"rotation": 0, **fields})


def test_fit_modes_produce_the_exact_size_with_bars_only_when_padding():
    for mode in ("stretch", "pad", "crop"):
        t = transform(output_width=1280, output_height=720, fit_mode=mode)
        graph, label, _ = build_filter_complex([], 640, 480, transform=t)
        frame = render(graph, label, 640, 480)
        assert len(frame) == 1280 * 720 * 3, mode
        left = pixel(frame, 1280, 4, 360)
        if mode == "pad":
            assert max(left) < 20, (mode, left)
        else:
            assert min(left) > 100, (mode, left)


def stamp(region, **extra):
    return {
        "mode": "datetime", "region": region, "clock_start_epoch": 1791288253,
        "clock_layout": "single", "font_size": 30, "font_family": "Arial",
        "bg_enabled": True, "bg_color": "black", "bg_opacity": 0.43, "box_border_width": 0,
        "safe_margin": 0, "vertical_align": "center", **extra,
    }


def test_stamp_is_drawn_upright_on_the_output_frame():
    region = {"x": 0.05, "y": 0.05, "w": 0.6, "h": 0.12}
    for fields, out_w, out_h in (
        ({"output_width": 1280, "output_height": 720, "fit_mode": "stretch"}, 1280, 720),
        ({"rotation": 90, "flip_h": True, "output_width": 720, "output_height": 960,
          "fit_mode": "stretch"}, 720, 960),
    ):
        graph, label, _ = build_filter_complex([stamp(region, text_scale_x=1.5)], 640, 480,
                                               transform=transform(**fields))
        exported = render(graph, label, 640, 480)
        ref_graph, ref_label, _ = build_filter_complex(
            [{**stamp(region, text_scale_x=1.5), "mode": "text", "text": "06/10/2026 12:04:13",
              "auto_fit": False, "text_wrap": False, "truncate": "none", "line_height": 1,
              "region": {"x": round(0.05 * out_w), "y": round(0.05 * out_h),
                         "w": round(0.6 * out_w), "h": round(0.12 * out_h)}}],
            out_w, out_h)
        assert exported == render(ref_graph, ref_label, out_w, out_h), fields


if __name__ == "__main__":
    test_fit_modes_produce_the_exact_size_with_bars_only_when_padding()
    test_stamp_is_drawn_upright_on_the_output_frame()
    print("output fit: all checks passed")
