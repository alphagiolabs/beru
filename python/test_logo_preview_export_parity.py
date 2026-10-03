"""Real FFmpeg characterization of logo preview, export, timing and text."""

import base64
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import processor
from temporal_pipeline import TemporalPatchResolver, extra_media_input_args
from delogo_chains import _clamp_delogo_rect

FFMPEG = Path(processor.find_ffmpeg())
FFPROBE = Path(processor.find_ffprobe(str(FFMPEG)))


def run(*args, input_bytes=None):
    result = subprocess.run(args, input=input_bytes, capture_output=True, timeout=90)
    assert result.returncode == 0, result.stderr.decode(errors="replace")[-2000:]
    return result.stdout


def rgb_frame(path_or_bytes, width, height, timestamp=None):
    args = [str(FFMPEG), "-v", "error"]
    if timestamp is not None:
        args += ["-ss", str(timestamp)]
    if isinstance(path_or_bytes, bytes):
        args += ["-f", "image2pipe", "-i", "pipe:0"]
    else:
        args += ["-i", str(path_or_bytes)]
    args += ["-frames:v", "1", "-vf", f"scale={width}:{height}", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
    result = run(*args, input_bytes=path_or_bytes if isinstance(path_or_bytes, bytes) else None)
    assert len(result) == width * height * 3
    return result


def mean_error(a, b, box=None, width=None):
    if box is None:
        return sum(abs(x - y) for x, y in zip(a, b)) / len(a)
    x0, y0, w, h = box
    offsets = ((y * width + x) * 3 + c for y in range(y0, y0 + h)
               for x in range(x0, x0 + w) for c in range(3))
    diffs = [abs(a[i] - b[i]) for i in offsets]
    return sum(diffs) / len(diffs)


def render_export(src, dst, operations, duration=2):
    with tempfile.TemporaryDirectory(prefix="beru-parity-motion-") as directory:
        _render_export(src, dst, operations, duration, directory)


def _render_export(src, dst, operations, duration, directory):
    width, height = dimensions(src)
    info = processor.ffprobe(str(src))
    resolver = TemporalPatchResolver(str(src), directory, str(FFMPEG), info["frame_rate"],
                                     source_format=info.get("pix_fmt"))
    graph, label, image_paths = processor.build_filter_complex(
        operations, width, height, source_pix_fmt=info.get("pix_fmt"),
        temporal_resolver=resolver,
    )
    args = [str(FFMPEG), "-v", "error", "-y", "-i", str(src)]
    for img in image_paths:
        args += extra_media_input_args(str(img), duration=duration)
    args += ["-filter_complex", graph, "-map", label, "-map", "0:a:0",
             "-c:v", "ffv1", "-c:a", "pcm_s16le", str(dst)]
    if image_paths:
        args.insert(-1, "-shortest")
    run(*args)


def dimensions(path):
    data = json.loads(run(str(FFPROBE), "-v", "error", "-select_streams", "v:0",
                          "-show_entries", "stream=width,height", "-of", "json", str(path)))
    stream = data["streams"][0]
    return stream["width"], stream["height"]


def assert_audio_video_sync(path):
    metadata = json.loads(run(str(FFPROBE), "-v", "error", "-show_entries",
                              "format=duration:stream=codec_type,start_time,duration,r_frame_rate",
                              "-of", "json", str(path)))
    streams = {stream["codec_type"]: stream for stream in metadata["streams"]}
    assert "audio" in streams and "video" in streams
    assert abs(float(metadata["format"]["duration"]) - 2) <= 0.11
    assert abs(float(streams["audio"]["start_time"]) -
               float(streams["video"]["start_time"])) <= 0.05
    if "duration" in streams["audio"] and "duration" in streams["video"]:
        assert abs(float(streams["audio"]["duration"]) -
                   float(streams["video"]["duration"])) <= 0.11
    assert streams["video"]["r_frame_rate"] == "10/1"


def test_preview_export_parity():
    assert (FFMPEG.is_file() or shutil.which(str(FFMPEG))) and (
        FFPROBE.is_file() or shutil.which(str(FFPROBE))
    ), "FFmpeg and ffprobe required"
    processor.FFMPEG = str(FFMPEG)
    processor.FFPROBE = str(FFPROBE)
    with tempfile.TemporaryDirectory(prefix="beru_logo_parity_") as temp:
        folder = Path(temp)
        for width, height in ((320, 180), (180, 320)):
            src = folder / f"source_{width}.mkv"
            dst = folder / f"export_{width}.mkv"
            text_only = folder / f"text_{width}.mkv"
            run(str(FFMPEG), "-v", "error", "-y", "-f", "lavfi", "-i",
                f"testsrc2=s={width}x{height}:r=10:d=2", "-f", "lavfi", "-i",
                "sine=frequency=440:sample_rate=48000:duration=2", "-vf",
                f"drawbox=x=0:y=0:w=36:h=22:color=white:t=fill,"
                f"drawbox=x=10:y=5:w=16:h=12:color=black:t=fill,"
                f"drawbox=x={width-39}:y={height-25}:w=39:h=25:color=red:t=fill,"
                f"drawbox=x={width-28}:y={height-19}:w=15:h=12:color=white:t=fill",
                "-c:v", "ffv1", "-c:a", "pcm_s16le", "-shortest", str(src))
            text = {"mode": "text", "region": {"x": 50, "y": 35, "w": 90, "h": 45},
                    "text": "EXCEL", "font_size": 24, "font_color": "yellow"}
            logo_ops = [
                {"mode": "delogo", "delogo_method": "blur", "edge_feather": 0,
                 "blur_strength": 30, "region": {"x": 0, "y": 0, "w": 36, "h": 22},
                 "start_time": 0.7, "end_time": 1.7},
                {"mode": "delogo", "delogo_method": "blur", "edge_feather": 6,
                 "blur_strength": 50,
                 "region": {"x": width-39, "y": height-25, "w": 39, "h": 25}},
            ]
            operations = [text, *logo_ops]
            render_export(src, dst, operations)
            render_export(src, text_only, [text])
            assert dimensions(dst) == (width, height)

            assert_audio_video_sync(dst)

            for ts in (0.2, 1.2):
                result = processor.render_preview_frame({"input_path": str(src),
                    "width": width, "height": height, "timestamp": ts,
                    "operations": operations})
                assert result["ok"], result.get("error")
                jpeg = base64.b64decode(result["data_url"].split(",", 1)[1])
                preview = rgb_frame(jpeg, width, height)
                export = rgb_frame(dst, width, height, ts)
                frame_error = mean_error(preview, export)
                assert frame_error <= 12, (width, height, ts, frame_error)

                baseline = rgb_frame(text_only, width, height, ts)
                text_error = mean_error(export, baseline, (50, 35, 90, 45), width)
                assert text_error <= 1
                print(f"{width}x{height} t={ts}: preview/export RGB MAE={frame_error:.2f}; "
                      f"text region MAE={text_error:.2f}")
                if ts < 0.7:
                    assert mean_error(export, baseline, (0, 0, 36, 22), width) <= 1
                else:
                    assert mean_error(export, baseline, (0, 0, 36, 22), width) >= 2

            shipped = folder / f"shipped_{width}.mp4"
            job = {"id": 0, "input_path": str(src), "output_path": str(shipped),
                   "source_width": width, "source_height": height,
                   "width": width, "height": height, "pix_fmt": "yuv420p",
                   "audio_codec": "pcm_s16le", "encode_profile": "uquality",
                   "operations": operations}
            outcome = processor._process_one(0, job, str(FFMPEG), hw_encoder=None)
            assert outcome["status"] == "succeeded", outcome
            assert dimensions(shipped) == (width, height)
            assert_audio_video_sync(shipped)
            shipped_frame = rgb_frame(shipped, width, height, 1.2)
            shipped_error = mean_error(preview, shipped_frame)
            shipped_text_error = mean_error(shipped_frame, baseline, (50, 35, 90, 45), width)
            assert shipped_error <= 18
            assert shipped_text_error <= 8
            print(f"{width}x{height} H.264 export: RGB MAE={shipped_error:.2f}; "
                  f"text region MAE={shipped_text_error:.2f}")

            crop = {"mode": "crop", "region": {"x": 20, "y": 14,
                    "w": width - 40, "h": height - 28}}
            cropped = folder / f"crop_{width}.mkv"
            render_export(src, cropped, [crop])
            assert dimensions(cropped) == (width - 40, height - 28)
            shipped_crop = folder / f"shipped_crop_{width}.mp4"
            crop_job = {**job, "output_path": str(shipped_crop), "operations": [crop]}
            assert processor._process_one(1, crop_job, str(FFMPEG), hw_encoder=None)[
                "status"
            ] == "succeeded"
            assert dimensions(shipped_crop) == dimensions(cropped)
            assert_audio_video_sync(shipped_crop)
            result = processor.render_preview_frame({"input_path": str(src),
                "width": width, "height": height, "timestamp": 1.2,
                "operations": [crop]})
            assert result["ok"], result.get("error")
            assert (result["width"], result["height"]) == dimensions(cropped)
            jpeg = base64.b64decode(result["data_url"].split(",", 1)[1])
            preview = rgb_frame(jpeg, *dimensions(cropped))
            export = rgb_frame(cropped, *dimensions(cropped), 1.2)
            crop_error = mean_error(preview, export)
            assert crop_error <= 12
            print(f"{width}x{height} crop {dimensions(cropped)}: RGB MAE={crop_error:.2f}")

            odd_op = {"mode": "delogo", "delogo_method": "blur", "edge_feather": 0,
                      "blur_strength": 30,
                      "region": {"x": 51, "y": 61, "w": 33, "h": 21}}
            odd_graph, odd_label, _ = processor.build_filter_complex([odd_op], width, height)
            actual_raw = run(str(FFMPEG), "-v", "error", "-ss", "1.2", "-i", str(src),
                             "-filter_complex", odd_graph, "-map", odd_label,
                             "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
            expected_raw = run(str(FFMPEG), "-v", "error", "-ss", "1.2", "-i", str(src),
                               "-vf", "boxblur=luma_radius=10:luma_power=3:chroma_radius=5:chroma_power=3",
                               "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
            assert mean_error(actual_raw, expected_raw, (54, 64, 27, 15), width) <= 2


def test_clamped_region_keeps_the_visible_box():
    assert _clamp_delogo_rect(-10, -5, 30, 20, 320, 180) == (0, 0, 20, 15)
    assert _clamp_delogo_rect(310, 170, 30, 20, 320, 180) == (310, 170, 10, 10)


def _preview_rgb(src, width, height, timestamp, operations):
    result = processor.render_preview_frame({
        "input_path": str(src),
        "width": width,
        "height": height,
        "timestamp": timestamp,
        "operations": operations,
        "asset_roots": [str(Path(src).parent)],
    })
    assert result["ok"], result.get("error")
    jpeg = base64.b64decode(result["data_url"].split(",", 1)[1])
    return rgb_frame(jpeg, width, height)


def _source_rgb(src, width, height, timestamp):
    """Decode the artifact frame for `timestamp` straight from the file."""
    args = [str(FFMPEG), "-v", "error", "-ss", str(timestamp), "-i", str(src),
            "-frames:v", "1", "-vf", f"scale={width}:{height}",
            "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
    data = run(*args)
    assert len(data) == width * height * 3
    return data


def test_preview_export_strict_parity():
    """Preview must activate the same ops on the same frames as the export.

    Every comparison decodes pixels; JPEG bytes are never the oracle. The
    preview path is MJPEG (lossy) while the export fixture is lossless FFV1,
    so a wrong enable window lands at MAE ~30+, well above the ~1-6 codec
    noise seen when parity holds.
    """
    assert (FFMPEG.is_file() or shutil.which(str(FFMPEG))) and (
        FFPROBE.is_file() or shutil.which(str(FFPROBE))
    ), "FFmpeg and ffprobe required"
    processor.FFMPEG = str(FFMPEG)
    processor.FFPROBE = str(FFPROBE)
    width, height = 320, 180
    fps = 10
    with tempfile.TemporaryDirectory(prefix="beru_strict_parity_") as temp:
        folder = Path(temp)
        src = folder / "src.mkv"
        run(str(FFMPEG), "-v", "error", "-y", "-f", "lavfi", "-i",
            f"testsrc2=s={width}x{height}:r={fps}:d=3", "-f", "lavfi", "-i",
            "sine=frequency=440:sample_rate=48000:duration=3", "-vf",
            "drawbox=x=0:y=0:w=60:h=40:color=white:t=fill",
            "-c:v", "ffv1", "-c:a", "pcm_s16le", "-shortest", str(src))
        png = folder / "overlay.png"
        run(str(FFMPEG), "-v", "error", "-y", "-f", "lavfi", "-i",
            "color=c=blue@0.6:s=50x30,format=rgba", "-frames:v", "1", str(png))

        windowed = [
            {"mode": "delogo", "delogo_method": "fill",
             "delogo_fill_color": "red", "delogo_fill_opacity": 1,
             "edge_feather": 0, "region": {"x": 0, "y": 0, "w": 60, "h": 40},
             "start_time": 1.0, "end_time": 1.5},
        ]
        dst = folder / "win.mkv"
        render_export(src, dst, windowed)
        for ts in (0.5, 0.9, 1.0, 1.2, 1.5, 1.6, 2.5):
            preview = _preview_rgb(src, width, height, ts, windowed)
            export = _source_rgb(dst, width, height, ts)
            err = mean_error(preview, export)
            bound = 6 if ts in (1.0, 1.2, 1.5) else 4
            assert err <= bound, (ts, err)
            print(f"windowed t={ts}: MAE={err:.2f}")

        temporal = [
            {"mode": "delogo", "delogo_method": "temporal", "temporal_radius": 3,
             "edge_feather": 0, "region": {"x": 0, "y": 0, "w": 60, "h": 40}},
        ]
        dst_t = folder / "temporal.mkv"
        render_export(src, dst_t, temporal)
        for ts in (0.8, 1.4, 2.6):
            preview = _preview_rgb(src, width, height, ts, temporal)
            export = _source_rgb(dst_t, width, height, ts)
            err = mean_error(preview, export)
            assert err <= 8, (ts, err)
            print(f"temporal t={ts}: MAE={err:.2f}")

        ordered = [
            {"mode": "delogo", "delogo_method": "blur", "blur_strength": 35,
             "edge_feather": 0, "region": {"x": 0, "y": 0, "w": 90, "h": 60}},
            {"mode": "image", "region": {"x": 10, "y": 10, "w": 50, "h": 30},
             "image_path": str(png), "image_opacity": 0.8},
            {"mode": "delogo", "delogo_method": "blur", "blur_strength": 40,
             "edge_feather": 0, "region": {"x": 200, "y": 100, "w": 60, "h": 40},
             "start_time": 0.5, "end_time": 2.0},
        ]
        interior_temporal = [{"mode": "delogo", "delogo_method": "temporal",
                              "temporal_radius": 3, "edge_feather": 0,
                              "region": {"x": 100, "y": 60, "w": 100, "h": 70}}]
        temporal_interior = folder / "temporal-interior.mkv"
        render_export(src, temporal_interior, interior_temporal)
        for ts in (0.8, 1.4):
            preview = _preview_rgb(src, width, height, ts, interior_temporal)
            export = _source_rgb(temporal_interior, width, height, ts)
            err = mean_error(preview, export, (100, 60, 100, 70), width)
            assert err <= 8, ("selected temporal method changed", ts, err)

        dst_o = folder / "ordered.mkv"
        render_export(src, dst_o, ordered)
        for ts in (0.2, 1.0, 2.4):
            preview = _preview_rgb(src, width, height, ts, ordered)
            export = _source_rgb(dst_o, width, height, ts)
            err = mean_error(preview, export)
            assert err <= 8, (ts, err)
            print(f"ordered t={ts}: MAE={err:.2f}")

        preview = _preview_rgb(src, width, height, 1.2, [])
        export = _source_rgb(src, width, height, 1.2)
        err = mean_error(preview, export)
        assert err <= 4, err
        print(f"no-ops t=1.2: MAE={err:.2f}")

        result = processor.render_source_frame(
            {"input_path": str(dst), "timestamp": 1.2})
        assert result["ok"], result.get("error")
        jpeg = base64.b64decode(result["data_url"].split(",", 1)[1])
        artifact = rgb_frame(jpeg, width, height)
        raw = _source_rgb(dst, width, height, 1.2)
        err = mean_error(artifact, raw)
        assert err <= 4, err
        region_err = mean_error(
            artifact, _source_rgb(src, width, height, 1.2),
            (0, 0, 60, 40), width)
        assert region_err > 20, region_err
        print(f"artifact decode t=1.2: MAE={err:.2f}, fill region MAE={region_err:.2f}")


if __name__ == "__main__":
    test_clamped_region_keeps_the_visible_box()
    test_preview_export_parity()
    test_preview_export_strict_parity()
    print("Logo preview/export parity: OK")
