import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from datetime_stamp import (
    clock_parts,
    parse_clock_epoch,
    shift_clock_epoch,
    split_clock_region,
)
from processor import build_filter_complex
from text_layout_helpers import _text_box_pad

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = str(ROOT / "bin" / "ffmpeg.exe")
W, H = 640, 120
REGION = {"x": 20, "y": 20, "w": 600, "h": 60}


def epoch(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp()


def render(graph, label, at, seek=None):
    cmd = [FFMPEG, "-v", "error"]
    if seek is not None:
        cmd += ["-ss", f"{seek:.3f}"]
    cmd += ["-f", "lavfi", "-i", f"color=c=gray:s={W}x{H}:d=20:r=10", "-filter_complex", graph,
            "-map", label, "-ss", f"{at:.3f}", "-frames:v", "1",
            "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    assert len(result.stdout) == W * H * 3
    return result.stdout


def stamp_op(start, **overrides):
    return {
        "mode": "datetime", "region": dict(REGION), "clock_start_epoch": epoch(start),
        "clock_format": "datetime", "clock_layout": "split", "clock_date_style": "dmy",
        "font_size": 28, "font_color": "white", "font_family": "Arial", "bg_enabled": True,
        "bg_color": "black", "bg_opacity": 0.45, "box_border_width": 6, "letter_spacing": 0,
        "vertical_align": "center", **overrides,
    }


def static_ops(op, texts):
    boxes = split_clock_region(REGION, [len(t) for t in texts], op["font_size"], _text_box_pad(op))
    return [{**op, "mode": "text", "text": t, "region": box, "auto_fit": False, "line_height": 1,
             "text_wrap": False, "truncate": "none"} for t, box in zip(texts, boxes)]


def expected(start, seconds, date_style="dmy"):
    moment = datetime.fromisoformat(start) + timedelta(seconds=seconds)
    date = {"dmy": "%d/%m/%Y", "mdy": "%m/%d/%Y", "ymd": "%Y/%m/%d"}[date_style]
    return [moment.strftime(date), moment.strftime("%H:%M:%S")]


def test_export_clock_matches_static_text():
    for start, at, overrides in (
        ("2026-10-06T12:04:13", 5.0, {}),
        ("2025-12-31T23:59:58", 5.0, {}),
        ("2028-02-28T23:59:59", 1.5, {}),
        ("2100-02-28T23:59:59", 1.0, {"clock_date_style": "ymd"}),
        ("1999-07-04T09:59:59", 7.0, {"clock_date_style": "mdy", "letter_spacing": 6}),
    ):
        op = stamp_op(start, **overrides)
        texts = expected(start, int(at), op["clock_date_style"])
        graph, label, _ = build_filter_complex([op], W, H)
        ref_graph, ref_label, _ = build_filter_complex(static_ops(op, texts), W, H)
        assert render(graph, label, at) == render(ref_graph, ref_label, at), (start, texts)


def test_preview_seek_shifts_clock_to_source_time():
    start, seek = "2026-10-06T12:04:13", 8.0
    op = stamp_op(start)
    graph, label, _ = build_filter_complex([shift_clock_epoch(op, seek)], W, H)
    ref_graph, ref_label, _ = build_filter_complex(static_ops(op, expected(start, 10)), W, H)
    assert render(graph, label, 2.0, seek=seek) == render(ref_graph, ref_label, 0)


def ink_box(frame):
    pixels = [(i // 3) for i in range(0, len(frame), 3) if frame[i] > 230]
    xs = [p % W for p in pixels]
    ys = [p // W for p in pixels]
    return min(xs), max(xs), min(ys), max(ys)


def test_stretched_clock_matches_stretched_static_text():
    start = "2026-10-06T12:04:13"
    op = stamp_op(start, clock_layout="single", text_scale_x=2.05, letter_spacing=3,
                  bg_enabled=False, font_size=20)
    texts = [" ".join(expected(start, 3))]
    graph, label, _ = build_filter_complex([op], W, H)
    ref_graph, ref_label, _ = build_filter_complex(static_ops(op, texts), W, H)
    assert render(graph, label, 3.0) == render(ref_graph, ref_label, 3.0)


def test_text_scale_x_stretches_ink_width_only():
    base = {"mode": "text", "text": "06/10/2026", "region": dict(REGION), "font_size": 28,
            "font_family": "Arial", "bg_enabled": False, "text_wrap": False}
    plain = ink_box(render(*build_filter_complex([base], W, H)[:2], 0))
    wide = ink_box(render(*build_filter_complex([{**base, "text_scale_x": 2}], W, H)[:2], 0))
    assert abs((wide[1] - wide[0]) - 2 * (plain[1] - plain[0])) <= 4, (plain, wide)
    assert (wide[2], wide[3]) == (plain[2], plain[3])
    assert abs(wide[0] - plain[0]) <= 3, (plain, wide)


def test_translucent_box_keeps_background_tint():
    op = {"mode": "text", "text": "x", "region": {"x": 0, "y": 0, "w": W, "h": H},
          "font_size": 8, "bg_enabled": True, "bg_color": "black", "bg_opacity": 0.43}
    graph, label, _ = build_filter_complex([op], W, H)
    result = subprocess.run(
        [FFMPEG, "-v", "error", "-f", "lavfi", "-i", f"color=c=0xc9d2df:s={W}x{H}:d=1",
         "-filter_complex", graph, "-map", label, "-frames:v", "1",
         "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    offset = (H // 2 * W + W - 20) * 3
    pixel = result.stdout[offset:offset + 3]
    expected = [round(c * 0.57) for c in (0xC9, 0xD2, 0xDF)]
    assert all(abs(a - b) <= 2 for a, b in zip(pixel, expected)), (list(pixel), expected)


def test_single_layout_and_partial_formats():
    op = stamp_op("2026-10-06T12:04:13")
    assert len(clock_parts(op)) == 2
    assert len(clock_parts({**op, "clock_layout": "single"})) == 1
    assert len(clock_parts({**op, "clock_format": "time"})) == 1
    assert clock_parts({**op, "clock_start_epoch": None}) == []


def test_invalid_epochs_are_rejected():
    for value in (None, True, "nan", -1, float("inf"), 253402300800, "x"):
        assert parse_clock_epoch(value) is None, value


def test_split_region_fills_width_with_one_gap():
    boxes = split_clock_region({"x": 10, "y": 5, "w": 400, "h": 40}, [10, 8], 30, 6)
    assert boxes[0]["x"] == 10
    assert boxes[1]["x"] + boxes[1]["w"] == 410
    assert boxes[1]["x"] - (boxes[0]["x"] + boxes[0]["w"]) == 9


if __name__ == "__main__":
    test_export_clock_matches_static_text()
    test_preview_seek_shifts_clock_to_source_time()
    test_stretched_clock_matches_stretched_static_text()
    test_text_scale_x_stretches_ink_width_only()
    test_translucent_box_keeps_background_tint()
    test_single_layout_and_partial_formats()
    test_invalid_epochs_are_rejected()
    test_split_region_fills_width_with_one_gap()
    print("ALL PASSED")
