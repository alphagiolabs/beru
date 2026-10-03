"""Pixel and timing contracts through the real Temporal export/preview pipeline."""

import base64
import json
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import numpy as np

import processor
from batch_context import BatchContext
from filters import build_filter_complex
from temporal_pipeline import TemporalPatchResolver, extra_media_input_args

FFMPEG = processor.find_ffmpeg()
FFPROBE = processor.find_ffprobe(FFMPEG)
processor.FFMPEG = FFMPEG
processor.FFPROBE = FFPROBE
WIDTH, HEIGHT, FPS = 192, 112, 25
BOX = {"x": 76, "y": 40, "w": 18, "h": 24}
OP = {
    "mode": "delogo",
    "delogo_method": "temporal",
    "temporal_radius": 4,
    "edge_feather": 0,
    "region": BOX,
}


def run(*args, data=None):
    result = subprocess.run(
        [str(arg) for arg in args], input=data, capture_output=True, timeout=60
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")[-2000:]
    return result.stdout


def source(folder, name, frames, *, depth="yuv444p", timing=None, audio=False):
    path = folder / f"{name}.mkv"
    args = [
        FFMPEG,
        "-v",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{WIDTH}x{HEIGHT}",
        "-r",
        FPS,
        "-i",
        "pipe:0",
    ]
    if audio:
        args += [
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={len(frames)/FPS}",
            "-c:a",
            "pcm_s16le",
        ]
    if timing:
        args += ["-vf", timing, "-fps_mode", "vfr"]
    run(*args, "-c:v", "ffv1", "-pix_fmt", depth, path, data=frames.tobytes())
    return path


def export(src, folder, name, ops, *, depth="yuv444p"):
    path = folder / f"{name}.mkv"
    resolver = TemporalPatchResolver(
        str(src), str(folder), FFMPEG, FPS, source_format=depth
    )
    graph, label, media = build_filter_complex(
        ops, WIDTH, HEIGHT, source_pix_fmt=depth, temporal_resolver=resolver
    )
    args = [FFMPEG, "-v", "error", "-y", "-i", src]
    for extra in media:
        args += extra_media_input_args(extra)
    run(
        *args,
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        graph,
        "-map",
        label,
        "-c:v",
        "ffv1",
        "-pix_fmt",
        depth,
        path,
    )
    return path


def decode(path, *, depth="rgb24", data=None):
    args = [FFMPEG, "-v", "error"]
    args += ["-f", "image2pipe", "-i", "pipe:0"] if data else ["-i", path]
    raw = run(
        *args,
        "-pix_fmt",
        depth,
        "-fps_mode",
        "passthrough",
        "-f",
        "rawvideo",
        "pipe:1",
        data=data,
    )
    if depth == "rgb24":
        return np.frombuffer(raw, np.uint8).reshape(-1, HEIGHT, WIDTH, 3)
    return np.frombuffer(raw, np.uint16 if "10" in depth else np.uint8).reshape(
        -1, 3, HEIGHT, WIDTH
    )


def texture():
    rng = np.random.default_rng(24)
    wide = rng.integers(20, 230, (HEIGHT, WIDTH + 100, 3), dtype=np.uint8)
    clean = np.stack([wide[:, index * 3 : index * 3 + WIDTH] for index in range(21)])
    clean[11:] = 255 - clean[11:]
    marked = clean.copy()
    marked[:, 40:64, 76:94] = 255
    return clean, marked


def test_motion_cuts_and_preview(folder):
    clean, marked = texture()
    src = source(folder, "motion", marked)
    dst = export(src, folder, "compensated", [OP])
    actual = decode(dst)
    error = float(
        np.abs(actual[:, 40:64, 76:94].astype(float) - clean[:, 40:64, 76:94]).mean()
    )
    assert len(actual) == len(marked), "Temporal changed the frame count"
    assert (
        error < 10
    ), f"Translated texture retained the logo or produced ghosts: {error}"
    native = decode(src, depth="yuv444p")
    output = decode(dst, depth="yuv444p")
    outside = np.ones((HEIGHT, WIDTH), bool)
    outside[40:64, 76:94] = False
    assert np.array_equal(
        output[:, :, outside], native[:, :, outside]
    ), "Temporal altered pixels outside the mask"
    for index in (0, 8, 10, 11, 16, 20):
        result = processor.render_preview_frame(
            {"input_path": str(src), "timestamp": index / FPS, "operations": [OP]}
        )
        assert result["ok"], result
        image = base64.b64decode(result["data_url"].split(",", 1)[1])
        preview = decode(None, data=image)[0]
        difference = float(np.abs(preview.astype(float) - actual[index]).mean())
        assert difference < 1, ("preview/export misalignment", index, difference)
    # Independent cut oracle: rendering each scene alone must give the same repair.
    for start, end in ((0, 11), (11, 21)):
        segment = source(folder, f"scene-{start}", marked[start:end])
        segment_out = decode(export(segment, folder, f"scene-out-{start}", [OP]))
        assert np.array_equal(
            segment_out, actual[start:end]
        ), "References crossed a scene cut"
    print(
        f"Motion/cut RGB core MAE={error:.3f}; exterior exact; frame count and previews preserved"
    )


def test_static_and_variable_timing(folder):
    frames = np.full((8, HEIGHT, WIDTH, 3), 48, np.uint8)
    frames[4:] = 176
    frames[:, 40:64, 76:94] = 255
    src = source(folder, "static-cuts", frames)
    actual = decode(export(src, folder, "static-out", [OP]))
    expected = np.array([48] * 4 + [176] * 4)
    assert np.max(np.abs(actual[:, 42:62, 78:92].mean(axis=(1, 2, 3)) - expected)) < 2
    colors = np.array([(0, 0, 255)] * 4 + [(255, 255, 0)] * 4, dtype=np.uint8)
    frames = np.broadcast_to(colors[:, None, None, :], (8, HEIGHT, WIDTH, 3)).copy()
    frames[:, 40:64, 76:94] = 255
    color_src = source(folder, "subsampled-colors", frames, depth="yuv420p")
    color_out = decode(
        export(color_src, folder, "subsampled-out", [OP], depth="yuv420p")
    )
    assert (
        np.abs(
            color_out[:, 42:62, 78:92].astype(float) - colors[:, None, None, :]
        ).mean()
        < 3
    )
    _, moving = texture()
    vfr = source(folder, "variable", moving, timing="setpts='(N+floor(N/3))*0.04/TB'")
    temporal = export(vfr, folder, "variable-temporal", [OP])
    spatial = folder / "variable-spatial.mkv"
    run(
        FFMPEG,
        "-v",
        "error",
        "-y",
        "-i",
        vfr,
        "-vf",
        "delogo=x=74:y=38:w=22:h=28",
        "-fps_mode",
        "passthrough",
        "-c:v",
        "ffv1",
        "-pix_fmt",
        "yuv444p",
        spatial,
    )
    assert np.array_equal(
        decode(temporal)[:, 40:64, 76:94], decode(spatial)[:, 40:64, 76:94]
    ), "VFR should use a safe spatial repair"

    def timestamps(path):
        return json.loads(
            run(
                FFPROBE,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_frames",
                "-show_entries",
                "frame=best_effort_timestamp_time",
                "-of",
                "json",
                path,
            )
        )["frames"]

    assert timestamps(temporal) == timestamps(
        vfr
    ), "Temporal changed variable frame timestamps"


def test_high_depth_and_actual_job(folder):
    _, marked = texture()
    src = source(folder, "depth10", marked, depth="yuv444p10le", audio=True)
    dst = export(src, folder, "depth10-out", [OP], depth="yuv444p10le")
    outside = np.ones((HEIGHT, WIDTH), bool)
    outside[40:64, 76:94] = False
    assert np.array_equal(
        decode(src, depth="yuv444p10le")[:, :, outside],
        decode(dst, depth="yuv444p10le")[:, :, outside],
    )
    job_path = folder / "actual-job.mp4"
    result = processor._process_one(
        0,
        {
            "id": 0,
            "input_path": str(src),
            "output_path": str(job_path),
            "operations": [
                {"mode": "crop", "region": {"x": 8, "y": 8, "w": 160, "h": 96}},
                {**OP, "region": {**BOX, "x": 68, "y": 32}},
            ],
            "encode_profile": "uquality",
            "trim_start": 0.12,
            "trim_end": 0.72,
        },
        FFMPEG,
    )
    assert result["status"] == "succeeded", result
    metadata = json.loads(
        run(
            FFPROBE,
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            job_path,
        )
    )
    streams = {s["codec_type"]: s for s in metadata["streams"]}
    assert "audio" in streams and "video" in streams
    assert (streams["video"]["width"], streams["video"]["height"]) == (160, 96)
    assert (
        abs(
            float(streams["video"]["start_time"])
            - float(streams["audio"]["start_time"])
        )
        < 0.05
    )
    assert abs(float(metadata["format"]["duration"]) - 0.6) < 0.09


def test_cancellation_during_preparation(folder):
    _, marked = texture()
    src = source(folder, "cancel-source", marked)
    output = folder / "cancelled.mp4"
    ctx = BatchContext(ffmpeg_path=FFMPEG, ffprobe_path=FFPROBE)
    prior = set(Path(tempfile.gettempdir()).glob("beru-temporal-*"))
    timer = threading.Timer(0.3, ctx.cancel_event.set)
    timer.start()
    started = time.monotonic()
    try:
        result = processor._process_one(
            0,
            {
                "input_path": str(src),
                "output_path": str(output),
                "operations": [OP],
                "encode_profile": "uquality",
            },
            FFMPEG,
            ctx=ctx,
        )
    finally:
        timer.cancel()
        timer.join()
    assert result["status"] == "cancelled", result
    assert time.monotonic() - started < 3, "Temporal preparation ignored cancellation"
    assert not output.exists(), "Cancelled preparation left an exported video"
    assert set(Path(tempfile.gettempdir()).glob("beru-temporal-*")) == prior


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="beru-motion-test-") as directory:
        root = Path(directory)
        test_motion_cuts_and_preview(root)
        test_static_and_variable_timing(root)
        test_high_depth_and_actual_job(root)
        test_cancellation_during_preparation(root)
    print("Temporal motion, cuts, timing, precision and actual-job checks passed")
