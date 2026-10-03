"""Compare exported text pixels with FFmpeg's literal UTF-8 textfile input."""

import os
import subprocess
import tempfile
from pathlib import Path

from processor import build_filter_complex


ROOT = Path(__file__).resolve().parents[1]
FFMPEG = str(ROOT / "bin" / "ffmpeg.exe")
FONT = (Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arial.ttf").as_posix()
FONT_OPTION = FONT.replace(":", "\\:")


def render(graph, label):
    result = subprocess.run(
        [FFMPEG, "-v", "error", "-f", "lavfi", "-i",
         "color=c=black:s=320x180:d=0.1", "-filter_complex", graph,
         "-map", label, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
        capture_output=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    assert not result.stderr, result.stderr.decode(errors="replace")
    assert len(result.stdout) == 320 * 180 * 3
    assert any(result.stdout), "Text disappeared from the exported frame"
    return result.stdout


def reference(text, directory, watermark=False):
    textfile = Path(directory) / "text.txt"
    textfile.write_bytes(text.encode("utf-8"))
    path_option = textfile.as_posix().replace(":", "\\:")
    position = "x=10:y=10:shadowx=1:shadowy=1:shadowcolor=black@0.5" if watermark else "x=0:y=0:y_align=text"
    graph = (
        f"[0:v]drawtext=textfile='{path_option}':expansion=none:"
        f"fontfile='{FONT_OPTION}':fontsize=24:fontcolor=white:{position}[out]"
    )
    return render(graph, "[out]")


def test_exported_text_matches_literal_input():
    failures = []
    with tempfile.TemporaryDirectory(prefix="beru-literal-") as directory:
        for text in (
            "O'Reilly", "100%", "a\nb", r"a\b", "x:y;z,t=2", "%{localtime}",
            "Price: ${99}", "Oferta [2026]", "safe'];movie=/tmp/payload[out]",
        ):
            for watermark in (False, True):
                try:
                    if watermark:
                        graph, label, _ = build_filter_complex([], 320, 180, watermark={
                            "enabled": True, "type": "text", "text": text,
                            "fontSize": 24, "fontColor": "white", "fontFamily": "Arial",
                            "position": "top-left", "opacity": 1,
                        })
                    else:
                        graph, label, _ = build_filter_complex([{
                            "mode": "text", "text": text, "font_size": 24,
                            "region": {"x": 0, "y": 0, "w": 300, "h": 150},
                            "bg_enabled": False, "text_wrap": False, "line_height": 1,
                        }], 320, 180)
                    assert render(graph, label) == reference(text, directory, watermark), "Literal text pixels differ"
                except (AssertionError, ValueError) as error:
                    failures.append(f"{text!r}, watermark={watermark}: {error}")
    assert not failures, "\n".join(failures)


def test_tight_spacing_accepts_literal_punctuation():
    graph, label, _ = build_filter_complex([{
        "mode": "text", "text": "50% O'Reilly", "font_size": 24,
        "region": {"x": 0, "y": 0, "w": 300, "h": 150},
        "bg_enabled": False, "text_wrap": False, "letter_spacing": -2,
    }], 320, 180)
    render(graph, label)


if __name__ == "__main__":
    test_exported_text_matches_literal_input()
    test_tight_spacing_accepts_literal_punctuation()
    print("ALL PASSED")
