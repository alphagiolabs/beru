import subprocess
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

import temporal_pipeline
from batch_context import BatchContext
from filters import build_filter_complex
from temporal_pipeline import TemporalPatchResolver, extra_media_input_args
from test_temporal_motion import FFMPEG, FPS, HEIGHT, WIDTH, run, source, texture


OPS = [
    {
        "mode": "delogo",
        "delogo_method": "temporal",
        "temporal_radius": radius,
        "edge_feather": 0,
        "region": {"x": x, "y": 40, "w": 18, "h": 24},
    }
    for x, radius in ((20, 2), (150, 5))
]


def prepare(src, folder, ops, *, batch=True, depth="yuv444p",
            dimensions=(WIDTH, HEIGHT), processes=None, **kwargs):
    folder.mkdir(exist_ok=True)
    resolver = TemporalPatchResolver(
        str(src), str(folder), FFMPEG, FPS, source_format=depth, **kwargs
    )
    processes = processes if processes is not None else []
    popen = subprocess.Popen

    def launch(command, **options):
        proc = popen(command, **options)
        processes.append((command, proc))
        return proc

    try:
        with patch.object(temporal_pipeline.subprocess, "Popen", side_effect=launch):
            graph, label, media = build_filter_complex(
                ops, *dimensions, source_pix_fmt=depth,
                temporal_resolver=resolver if batch else lambda *args: resolver(*args),
            )
    finally:
        assert all(proc.poll() is not None for _, proc in processes), "FFmpeg leaked"
    decoders = sum(command[-1] == "pipe:1" for command, _ in processes)
    return (graph, label, media), decoders


def pixels(path):
    return run(FFMPEG, "-v", "error", "-i", path, "-pix_fmt", "rgb48le",
               "-f", "rawvideo", "pipe:1")


def composite(src, prepared, folder, depth):
    graph, label, media = prepared
    output = folder / "export.mkv"
    args = [FFMPEG, "-v", "error", "-y", "-i", src]
    for path in media:
        args += extra_media_input_args(path)
    run(*args, "-filter_complex_threads", "1", "-filter_complex", graph,
        "-map", label, "-c:v", "ffv1", "-pix_fmt", depth, output)
    return pixels(output)


def assert_parity(src, folder, ops, depth, *, expected_decoders=1, **kwargs):
    folder.mkdir()
    serial, serial_decoders = prepare(src, folder / "serial", ops, batch=False, depth=depth, **kwargs)
    processes = []
    batched, batch_decoders = prepare(src, folder / "batch", ops, depth=depth, processes=processes, **kwargs)
    expected_patches = sum(op["mode"] == "delogo" for op in ops)
    assert serial_decoders == expected_patches
    assert batch_decoders == expected_decoders, f"Expected {expected_decoders} decoder(s), got {batch_decoders}"
    assert len(processes) == expected_decoders + expected_patches
    assert len(serial[2]) == len(batched[2]) == expected_patches
    for before, after in zip(serial[2], batched[2]):
        assert pixels(before) == pixels(after), f"Shared decoder changed patch pixels: {depth}"
    assert composite(src, serial, folder / "serial", depth) == composite(
        src, batched, folder / "batch", depth
    ), f"Shared decoding changed the composited export: {depth}"
    print(f"{folder.name}: identical patches/export; {serial_decoders} -> {batch_decoders} decoder(s)", flush=True)


def test_independent_parity(folder):
    _, marked = texture()
    for op in OPS:
        box = op["region"]
        marked[:, box["y"]:box["y"] + box["h"], box["x"]:box["x"] + box["w"]] = 255
    for depth in ("yuv420p", "yuv422p", "yuv444p", "yuv420p10le", "yuv422p10le", "yuv444p10le",
                  "yuvj420p", "yuvj422p", "yuvj444p"):
        src = source(folder, depth, marked, depth=depth)
        assert_parity(src, folder / depth, OPS, depth,
                      expected_decoders=2 if depth.startswith("yuvj") else 1)

    src = source(folder, "mixed", marked)
    mixed = [{**OPS[0], "delogo_method": "inpaint", "edge_feather": 6}, OPS[1]]
    assert_parity(src, folder / "mixed", mixed, "yuv444p")
    crop = {"mode": "crop", "region": {"x": 8, "y": 8, "w": 176, "h": 96}}
    bounded = [crop, {**OPS[0], "startTime": 0.24, "endTime": 0.52},
               {**OPS[1], "temporal_radius": 2, "start_time": 0.24, "end_time": 0.52}]
    assert_parity(src, folder / "bounded", bounded[1:], "yuv444p", frame_limit=17)
    assert_parity(src, folder / "bounded-crop", bounded, "yuv444p", frame_limit=17)
    assert_parity(src, folder / "seek", bounded, "yuv444p", expected_decoders=2,
                  seek=0.08, frame_limit=17)
    assert_parity(src, folder / "three", THREE_OPS, "yuv444p")
    blur = {"mode": "blur", "region": {"x": 80, "y": 40, "w": 12, "h": 12}}
    assert_parity(src, folder / "common-prefix", [blur, *OPS], "yuv444p")


def test_serial_dependencies_and_windows(folder):
    _, marked = texture()
    src = source(folder, "serial-fallbacks", marked)
    cases = {
        "windows": [OPS[0], {**OPS[1], "startTime": 0.32}],
        "expanded-windows": [{**op, "start_time": 0.32} for op in OPS],
        "overlap": [OPS[0], {**OPS[1], "region": {"x": 26, "y": 40, "w": 18, "h": 24}}],
        "context": [OPS[0], {**OPS[1], "region": {"x": 54, "y": 40, "w": 18, "h": 24}}],
        "intervening-filter": [OPS[0], {"mode": "blur", "region": OPS[1]["region"]}, OPS[1]],
    }
    for name, ops in cases.items():
        assert_parity(src, folder / name, ops, "yuv444p", expected_decoders=2)


THREE_OPS = [
    {**OPS[0], "region": {"x": x, "y": y, "w": 8, "h": 8}}
    for x, y in ((2, 2), (86, 44), (176, 100))
]


def test_cancellation_and_progress(folder):
    _, marked = texture()
    src = source(folder, "cancel", marked)
    ctx = BatchContext(ffmpeg_path=FFMPEG)
    processes, progress = [], []

    def report(index, percent, speed, *, ctx, fields):
        progress.append(percent)
        assert index == 7 and fields == {"phase": "patch"}
        if percent >= 22:
            ctx.cancel_event.set()

    output = folder / "cancel-output"
    with patch.object(temporal_pipeline, "_emit_job_progress", side_effect=report):
        try:
            prepare(src, output, THREE_OPS, processes=processes, ctx=ctx,
                    job_id=7, progress_range=(20, 30), total_frames=len(marked))
        except RuntimeError as exc:
            assert "Cancelled" in str(exc), str(exc)
        else:
            raise AssertionError("Preparation ignored cancellation")
    assert len(processes) == 4, "Cancellation did not exercise a three-patch batch"
    assert all(proc.poll() is not None for _, proc in processes)
    assert not list(output.glob("*.mkv")), "Cancelled batch left partial patches"
    assert progress[0] == 20 and all(20 <= value <= 30 for value in progress)


def test_variable_timing_and_budget(folder):
    _, marked = texture()
    vfr = source(folder, "vfr", marked,
                 timing="setpts=if(gte(N\\,10)\\,PTS+0.2/TB\\,PTS)")
    assert_parity(vfr, folder / "vfr-parity", OPS, "yuv444p")
    regular = source(folder, "regular", marked)
    irregular = folder / "irregular.mkv"
    run(FFMPEG, "-v", "error", "-y", "-i", regular,
        "-vf", "settb=1/1000,setpts=(N-0.9*mod(N\\,2))*0.04/TB",
        "-fps_mode", "passthrough", "-enc_time_base", "1:1000",
        "-c:v", "ffv1", "-pix_fmt", "yuv444p", irregular)
    for name, src, kwargs, code in (
        ("irregular", irregular, {}, "patch_skipped_timing"),
        ("timeout", regular, {"timeout": 0.01}, "patch_skipped_budget"),
        ("disk", regular, {}, "patch_skipped_budget"),
    ):
        output = folder / f"{name}-output"
        budget_file = None
        if name == "disk":
            output.mkdir()
            budget_file = output / "budget.mkv"
            with budget_file.open("wb") as stream:
                stream.truncate(513 * 1024 * 1024)
        warnings = []
        with patch.object(temporal_pipeline, "_emit_warning", side_effect=lambda *args: warnings.append(args)):
            prepared, decoders = prepare(src, output, OPS, job_id=3, **kwargs)
        assert decoders == 1 and not prepared[2]
        assert [warning[1] for warning in warnings] == [code, code]
        if budget_file is not None:
            budget_file.unlink()
        assert not list(output.glob("*.mkv")), "Deferred batch left partial patches"


def test_atlas_budget(folder):
    src = folder / "4k.mkv"
    run(FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i",
        "color=size=3840x2160:rate=25", "-frames:v", 3,
        "-c:v", "ffv1", "-pix_fmt", "yuv444p", src)
    ops = [{**OPS[0], "region": box} for box in (
        {"x": 100, "y": 100, "w": 3500, "h": 8},
        {"x": 3750, "y": 600, "w": 18, "h": 1300},
    )]
    prepared, decoders = prepare(src, folder / "atlas-cap", ops, dimensions=(3840, 2160))
    assert decoders == 2 and len(prepared[2]) == 2, "Oversized atlas was batched"


if __name__ == "__main__":
    if not shutil.which(FFMPEG):
        print("SKIP temporal batch: FFmpeg unavailable")
        raise SystemExit(0)
    with tempfile.TemporaryDirectory(prefix="beru-temporal-batch-") as directory:
        root = Path(directory)
        test_independent_parity(root)
        test_serial_dependencies_and_windows(root)
        test_cancellation_and_progress(root)
        test_variable_timing_and_budget(root)
        test_atlas_budget(root)
    print("Temporal batch pixels, decoder counts, serial fallback, cancellation and budgets passed")
