#!/usr/bin/env python3
import sys
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from filters import build_filter_complex# noqa: E402
import job_classify
import media_probe


def test_text_watermark_positions_match_the_selected_frame_edges():
    width, height = 640, 360
    for vertical in ("top", "center", "bottom"):
        for horizontal in ("left", "center", "right"):
            position = "center" if vertical == horizontal == "center" else f"{vertical}-{horizontal}"
            graph, label, _ = build_filter_complex([], width, height, watermark={
                "enabled": True, "type": "text", "text": "WM", "fontSize": 30,
                "opacity": 1, "position": position,
            })
            result = subprocess.run(
                [media_probe.find_ffmpeg(), "-v", "error", "-f", "lavfi", "-i",
                 f"color=black:s={width}x{height}:d=0.1", "-filter_complex", graph,
                 "-map", label, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
                capture_output=True, timeout=30,
            )
            assert result.returncode == 0, result.stderr.decode(errors="replace")
            points = [(i % width, i // width) for i in range(width * height)
                      if max(result.stdout[3*i:3*i+3]) > 180]
            assert points, position
            x0, x1 = min(x for x, _ in points), max(x for x, _ in points)
            y0, y1 = min(y for _, y in points), max(y for _, y in points)
            for align, start, end, extent in (
                (horizontal, x0, x1, width), (vertical, y0, y1, height),
            ):
                if align in ("left", "top"):
                    assert abs(start - 10) <= 2, (position, start, end)
                elif align in ("right", "bottom"):
                    assert abs(extent - 1 - end - 10) <= 4, (position, start, end)
                else:
                    assert abs((start + end) / 2 - extent / 2) <= 2, (position, start, end)


def test_stream_copy_gate_requires_no_watermark():
    wm = {"enabled": True, "type": "text", "text": "WM"}
    assert not job_classify.job_takes_copy_path({"operations": [], "watermark": wm})
    assert job_classify.job_takes_copy_path({"operations": []})
    assert job_classify.job_takes_copy_path({"watermark": {"enabled": False}})


if __name__ == "__main__":
    test_stream_copy_gate_requires_no_watermark()
    test_text_watermark_positions_match_the_selected_frame_edges()
    print("ALL PASSED")
