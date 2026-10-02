"""A trim keeps video, audio, and timed logo operations on the source timeline."""

import json
import subprocess
import tempfile
from pathlib import Path

import processor


FFMPEG = processor.find_ffmpeg()
FFPROBE = processor.find_ffprobe(FFMPEG)


def run(*args):
    result = subprocess.run(args, capture_output=True, timeout=90)
    assert result.returncode == 0, result.stderr.decode(errors="replace")[-2000:]
    return result.stdout


def probe(path):
    return json.loads(run(
        FFPROBE, "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,start_time,duration", "-of", "json", str(path),
    ))


def center_pixel(path, timestamp):
    frame = run(
        FFMPEG, "-v", "error", "-ss", str(timestamp), "-i", str(path),
        "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    )
    offset = (32 * 64 + 32) * 3
    return frame[offset:offset + 3]


def test_trimmed_logo_export():
    with tempfile.TemporaryDirectory(prefix="beru_trim_") as temp:
        folder = Path(temp)
        source = folder / "source.mp4"
        run(
            FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i",
            "color=c=blue:s=64x64:r=10:d=3", "-f", "lavfi", "-i",
            "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", str(source),
        )
        common = {
            "input_path": str(source), "width": 64, "height": 64,
            "asset_roots": [str(folder)],
            "video_duration": 3, "frame_rate": 10, "pix_fmt": "yuv420p",
            "audio_codec": "aac", "trim_start": 0.5, "trim_end": 2.5,
            "encode_profile": "fast",
        }
        trimmed = folder / "trimmed.mp4"
        result = processor._process_one(
            0, {**common, "output_path": str(trimmed), "operations": []}, FFMPEG,
            hw_encoder="",
        )
        assert result["status"] == "succeeded", result
        metadata = probe(trimmed)
        streams = {s["codec_type"]: s for s in metadata["streams"]}
        assert "video" in streams and "audio" in streams
        assert abs(float(metadata["format"]["duration"]) - 2) < 0.12
        assert abs(float(streams["audio"]["start_time"]) -
                   float(streams["video"]["start_time"])) < 0.06

        logo_output = folder / "logo.mp4"
        operation = {
            "mode": "delogo", "region": {"x": 16, "y": 16, "w": 32, "h": 32},
            "delogo_method": "fill", "delogo_fill_color": "red",
            "delogo_fill_opacity": 1, "edge_feather": 0,
            "start_time": 1, "end_time": 2,
        }
        result = processor._process_one(
            0, {**common, "output_path": str(logo_output), "operations": [operation]},
            FFMPEG, hw_encoder="",
        )
        assert result["status"] == "succeeded", result
        before = center_pixel(logo_output, 0.2)
        during = center_pixel(logo_output, 1.0)
        assert before[2] > before[0], (before, during)
        assert during[0] > during[2], (before, during)

        patch = folder / "patch.png"
        run(
            FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i",
            "color=c=green:s=32x32", "-frames:v", "1", str(patch),
        )
        image_output = folder / "image.mp4"
        image_operation = {
            "mode": "image", "region": {"x": 16, "y": 16, "w": 32, "h": 32},
            "image_path": str(patch), "image_opacity": 1,
        }
        result = processor._process_one(
            0, {**common, "output_path": str(image_output), "operations": [image_operation]},
            FFMPEG, hw_encoder="",
        )
        assert result["status"] == "succeeded", result
        assert abs(float(probe(image_output)["format"]["duration"]) - 2) < 0.12
        late = center_pixel(image_output, 1.7)
        assert late[1] > late[2], late

        silent = folder / "silent.mp4"
        run(
            FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i",
            "color=c=blue:s=64x64:r=10:d=1", "-c:v", "libx264", str(silent),
        )
        silent_output = folder / "silent_trim.mp4"
        result = processor._process_one(
            0, {
                **common, "input_path": str(silent), "output_path": str(silent_output),
                "video_duration": 1, "trim_start": 0.2, "trim_end": 0.8,
                "audio_codec": "", "operations": [],
            },
            FFMPEG, hw_encoder="",
        )
        assert result["status"] == "succeeded", result
        assert abs(float(probe(silent_output)["format"]["duration"]) - 0.6) < 0.12


if __name__ == "__main__":
    test_trimmed_logo_export()
    print("Trim export: OK")
