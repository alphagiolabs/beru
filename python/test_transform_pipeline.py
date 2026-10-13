#!/usr/bin/env python3
"""Rotation, flips and output height through real ffmpeg, checked on corner colours.

Source: 160x90 with red (TL), lime (TR), blue (BL), yellow (BR). Quarter turns and flips
move those colours by the rules of each transform; the expected layouts below follow them.
"""
import subprocess
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from filters import build_filter_complex  # noqa: E402
from media_probe import find_ffmpeg, find_ffprobe  # noqa: E402

FFMPEG = find_ffmpeg()
RGB = {"red": (255, 0, 0), "lime": (0, 255, 0), "blue": (0, 0, 255), "yellow": (255, 255, 0)}
SOURCE = {"tl": "red", "tr": "lime", "bl": "blue", "br": "yellow"}


def transform(**fields):
    base = {"rotation": 0, "flip_h": False, "flip_v": False, "output_height": None}
    base.update(fields)
    return base


def make_corners(directory, name, extra=()):
    path = Path(directory) / name
    boxes = ("drawbox=x=0:y=0:w=16:h=16:color=red:t=fill,"
             "drawbox=x=144:y=0:w=16:h=16:color=lime:t=fill,"
             "drawbox=x=0:y=74:w=16:h=16:color=blue:t=fill,"
             "drawbox=x=144:y=74:w=16:h=16:color=yellow:t=fill")
    subprocess.run(
        [FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x202020:s=160x90:r=30:d=0.5",
         "-vf", boxes, "-c:v", "libx264", "-pix_fmt", "yuv420p", *extra, str(path)],
        check=True, timeout=60,
    )
    return str(path)


def render(source, operations, size_hint, transform_fields):
    graph, label, _ = build_filter_complex(operations, *size_hint, transform=transform_fields)
    if graph is None:
        graph, label = "[0:v]null[out]", "[out]"
    result = subprocess.run(
        [FFMPEG, "-v", "error", "-i", source, "-filter_complex", graph, "-map", label,
         "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
        capture_output=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    return result.stdout


def frame_size(buffer, width, height):
    assert len(buffer) == width * height * 3, (len(buffer), width, height)


def corner_names(buffer, width, height):
    def pixel(x, y):
        i = (y * width + x) * 3
        return buffer[i:i + 3]

    def nearest(rgb):
        return min(RGB, key=lambda name: sum((a - b) ** 2 for a, b in zip(rgb, RGB[name])))

    inset = 6
    return {
        "tl": nearest(pixel(inset, inset)),
        "tr": nearest(pixel(width - 1 - inset, inset)),
        "bl": nearest(pixel(inset, height - 1 - inset)),
        "br": nearest(pixel(width - 1 - inset, height - 1 - inset)),
    }


def check(source, fields, size, expected_size, expected_corners):
    buffer = render(source, [], size, fields)
    frame_size(buffer, *expected_size)
    observed = corner_names(buffer, *expected_size)
    assert observed == expected_corners, (fields, observed, expected_corners)


def run():
    with tempfile.TemporaryDirectory(prefix="beru-geometry-") as directory:
        source = make_corners(directory, "corners.mp4")
        size = (160, 90)
        check(source, transform(rotation=90), size, (90, 160),
              {"tl": "blue", "tr": "red", "br": "lime", "bl": "yellow"})
        check(source, transform(rotation=270), size, (90, 160),
              {"tl": "lime", "tr": "yellow", "br": "blue", "bl": "red"})
        check(source, transform(rotation=180), size, (160, 90),
              {"tl": "yellow", "tr": "blue", "br": "red", "bl": "lime"})
        check(source, transform(flip_h=True), size, (160, 90),
              {"tl": "lime", "tr": "red", "bl": "yellow", "br": "blue"})
        check(source, transform(flip_v=True), size, (160, 90),
              {"tl": "blue", "tr": "yellow", "bl": "red", "br": "lime"})
        # A quarter turn clockwise (TL blue, TR red, BR lime, BL yellow), then a horizontal flip.
        check(source, transform(rotation=90, flip_h=True), size, (90, 160),
              {"tl": "red", "tr": "blue", "bl": "lime", "br": "yellow"})
        # A resize keeps the proportion of the rotated frame and never upscales.
        shrunk = render(source, [], size, transform(output_height=44))
        frame_size(shrunk, 78, 44)
        frame_size(render(source, [], size, transform(output_height=1080)), 160, 90)

        # Metadata-rotated source: the decoder presents it as 90x160, with lime TL, yellow TR,
        # red BL and blue BR. A further quarter turn composes on top of that presentation.
        rotated = str(Path(directory) / "rotated.mp4")
        subprocess.run(
            [FFMPEG, "-v", "error", "-y", "-display_rotation:v:0", "90", "-i", source,
             "-c", "copy", "-an", rotated],
            check=True, timeout=60,
        )
        presented = {"tl": "lime", "tr": "yellow", "bl": "red", "br": "blue"}
        buffer = render(rotated, [], (160, 90), transform())
        frame_size(buffer, 90, 160)
        assert corner_names(buffer, 90, 160) == presented, corner_names(buffer, 90, 160)
        buffer = render(rotated, [], (160, 90), transform(rotation=90))
        frame_size(buffer, 160, 90)
        assert corner_names(buffer, 160, 90) == {"tl": "red", "tr": "lime", "br": "yellow", "bl": "blue"}


def run_preview():
    import preview

    with tempfile.TemporaryDirectory(prefix="beru-preview-geometry-") as directory:
        source = make_corners(directory, "corners.mp4")
        payload = {
            "input_path": source, "source_width": 160, "source_height": 90, "timestamp": 0.1,
            "operations": [], "video_duration": 0.5, "frame_rate": 30, "pix_fmt": "yuv420p",
        }
        for fields, expected in (
            ({}, (160, 90)),
            ({"rotation": 90}, (90, 160)),
            ({"output_height": 44}, (78, 44)),
        ):
            result = preview.render_preview_frame({**payload, **fields}, ffmpeg_path=FFMPEG)
            assert result.get("ok"), result
            assert (result["width"], result["height"]) == expected, (fields, result)


def check_regions_follow_the_transform():
    """Operations are placed in source coordinates; the transform then moves the result."""
    with tempfile.TemporaryDirectory(prefix="beru-regions-geometry-") as directory:
        source = str(Path(directory) / "logo.mp4")
        subprocess.run(
            [FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x202020:s=640x360:r=30:d=0.5",
             "-vf", "drawbox=x=32:y=24:w=96:h=36:color=white:t=fill", "-c:v", "libx264",
             "-pix_fmt", "yuv420p", source],
            check=True, timeout=60,
        )
        fill = {"mode": "delogo", "delogo_method": "fill", "delogo_fill_color": "red",
                "delogo_fill_opacity": 1, "edge_feather": 0,
                "region": {"x": 32, "y": 24, "w": 96, "h": 36}}

        def red_at(buffer, width, x, y):
            i = (y * width + x) * 3
            return buffer[i] > 200 and buffer[i + 1] < 60 and buffer[i + 2] < 60

        plain = render(source, [fill], (640, 360), transform())
        assert red_at(plain, 640, 60, 40) and not red_at(plain, 640, 580, 40)
        mirrored = render(source, [fill], (640, 360), transform(flip_h=True))
        assert red_at(mirrored, 640, 580, 40) and not red_at(mirrored, 640, 60, 40)


def check_export_without_upscale():
    """Presets at/above source height preserve the video through the real batch CLI."""
    with tempfile.TemporaryDirectory(prefix="beru-export-geometry-") as directory:
        root = Path(directory)
        source = make_corners(directory, "corners.mp4")
        jobs = [
            {"id": index, "input_path": source, "output_path": str(root / f"out-{height}.mp4"),
             "source_width": 160, "source_height": 90, "video_duration": 0.5,
             "video_codec": "h264", "pix_fmt": "yuv420p", "frame_rate": 30,
             "operations": [], "output_height": height, "encode_profile": "uquality"}
            for index, height in enumerate((90, 1080))
        ]
        portrait = str(root / "portrait.mp4")
        subprocess.run([FFMPEG, "-v", "error", "-i", source, "-vf", "transpose=1",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", portrait], check=True, timeout=30)
        jobs.append({**jobs[0], "id": 2, "input_path": portrait, "source_width": 90,
                     "source_height": 160, "output_path": str(root / "portrait-out.mp4")})
        manifest = root / "jobs.json"
        manifest.write_text(json.dumps({"type": "beru-job-manifest", "version": 1, "jobs": jobs}),
                            encoding="utf-8")
        result = subprocess.run([sys.executable, str(HERE / "processor.py"), str(manifest)],
                                capture_output=True, text=True, timeout=120)
        assert result.returncode == 0, result.stdout[-1000:] + result.stderr[-1000:]

        def video_hash(path):
            return subprocess.run(
                [FFMPEG, "-v", "error", "-i", path, "-map", "0:v:0", "-c:v", "copy",
                 "-f", "hash", "-hash", "sha256", "-"],
                capture_output=True, check=True, timeout=30,
            ).stdout

        original_hash = video_hash(source)
        for job in jobs:
            data = json.loads(subprocess.run(
                [find_ffprobe(FFMPEG), "-v", "error", "-show_streams", "-of", "json", job["output_path"]],
                capture_output=True, text=True, check=True, timeout=30,
            ).stdout)
            video = next(stream for stream in data["streams"] if stream["codec_type"] == "video")
            expected_size = (50, 90) if job["id"] == 2 else (160, 90)
            assert (video["width"], video["height"]) == expected_size, video
            assert video["r_frame_rate"] == "30/1", video
            assert abs(float(video["duration"]) - 0.5) < 0.04, video
            if job["id"] != 2:
                assert video_hash(job["output_path"]) == original_hash, "identity must not re-encode video"


if __name__ == "__main__":
    run()
    run_preview()
    check_regions_follow_the_transform()
    check_export_without_upscale()
    print("transform pipeline: all checks passed")
