"""Compare Temporal with its former coordinate median on controlled/real clips.

python python/temporal_quality_benchmark.py --input clean.mp4 --output .tmp/motion
Metrics use lossless RGB; the four-column MP4s are review copies only.
"""

import argparse
import json
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

from delogo_chains import _build_padded_region, _seamless_overlay_tail
from filters import build_filter_complex
from processor import find_ffmpeg
from temporal_pipeline import TemporalPatchResolver, extra_media_input_args

FFMPEG = find_ffmpeg()
FPS = 12


def run(args, data=None):
    result = subprocess.run(
        [str(a) for a in [FFMPEG, "-v", "error", *args]],
        input=data,
        capture_output=True,
        timeout=180,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-2000:])
    return result.stdout


def encode(path, frames, *, review=False):
    _, height, width, _ = frames.shape
    run(
        [
            "-y",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            f"{width}x{height}",
            "-r",
            FPS,
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "libx264" if review else "ffv1",
            "-threads",
            "1",
            "-pix_fmt",
            "yuv420p" if review else "yuv444p",
            path,
        ],
        frames.tobytes(),
    )


def render(path, graph, label, media, width, height):
    args = ["-threads", "1", "-i", path]
    for extra in media:
        args += extra_media_input_args(extra)
    if graph:
        args += [
            "-filter_complex_threads",
            "1",
            "-filter_complex",
            graph,
            "-map",
            label,
        ]
    raw = run(
        [
            *args,
            "-pix_fmt",
            "rgb24",
            "-fps_mode",
            "passthrough",
            "-f",
            "rawvideo",
            "pipe:1",
        ]
    )
    return np.frombuffer(raw, np.uint8).reshape(-1, height, width, 3)


def former_graph(box, width, height, radius, feather):
    x, y, w, h = (box[k] for k in ("x", "y", "w", "h"))
    bx, by, bw, bh = _build_padded_region(
        x, y, w, h, width, height, max(2, feather), aligned=True
    )
    if not feather:
        return (
            f"[0:v]split[full][work];[work]crop={w}:{h}:{x}:{y},"
            f"tmedian=radius={radius}:planes=0x7[clean];[full][clean]overlay={x}:{y}:format=yuv444[tmp0]"
        )
    return (
        f"[0:v]split[fulld0][work];[work]crop={bw}:{bh}:{bx}:{by},"
        f"tmedian=radius={radius}:planes=0x7[clean];"
        + _seamless_overlay_tail(
            "clean",
            "d0",
            0,
            bx,
            by,
            bw,
            bh,
            (x - bx, y - by, w, h),
            feather,
            "",
            "yuv444p",
        )
    )


def metrics(clean, output, box):
    x, y, w, h = (box[k] for k in ("x", "y", "w", "h"))
    error = (
        output[:, y : y + h, x : x + w].astype(float) - clean[:, y : y + h, x : x + w]
    )
    return {
        "core_mae": float(np.abs(error).mean()),
        "temporal_error_mae": float(np.abs(np.diff(error, axis=0)).mean()),
        "detail_error_mae": float(np.abs(np.diff(error, axis=2)).mean()),
    }


def evaluate(folder, name, clean, box, feather=0, radius=4):
    _, height, width, _ = clean.shape
    x, y, w, h = (box[k] for k in ("x", "y", "w", "h"))
    marked = clean.copy()
    marked[:, y : y + h, x : x + w] = 255
    path = folder / f"{name}-input.mkv"
    encode(path, marked)
    started = time.perf_counter()
    before = render(
        path,
        former_graph(box, width, height, radius, feather),
        "[tmp0]",
        [],
        width,
        height,
    )
    before_seconds = time.perf_counter() - started
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(dir=folder, prefix="patch-") as directory:
        resolver = TemporalPatchResolver(
            str(path), directory, FFMPEG, FPS, source_format="yuv444p"
        )
        op = {
            "mode": "delogo",
            "delogo_method": "temporal",
            "region": box,
            "temporal_radius": radius,
            "edge_feather": feather,
        }
        graph, label, media = build_filter_complex(
            [op], width, height, source_pix_fmt="yuv444p", temporal_resolver=resolver
        )
        after = render(path, graph, label, media, width, height)
        disk_bytes = sum(Path(p).stat().st_size for p in media)
    after_seconds = time.perf_counter() - started
    assert len(before) == len(after) == len(clean)
    decoded = render(path, None, None, [], width, height)
    outer = np.ones((height, width), bool)
    outer[
        max(0, y - feather) : y + h + feather, max(0, x - feather) : x + w + feather
    ] = False
    outside_max = int(np.abs(after[:, outer].astype(int) - decoded[:, outer]).max())
    panels = np.concatenate([clean, marked, before, after], axis=2)
    encode(folder / f"{name}-comparison.mp4", panels, review=True)
    for index in (len(clean) // 2 - 1, len(clean) // 2, len(clean) - 2):
        run(
            [
                "-y",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-s",
                f"{width*4}x{height}",
                "-i",
                "pipe:0",
                "-frames:v",
                "1",
                folder / f"{name}-{index}.png",
            ],
            panels[index].tobytes(),
        )
    # Full frames for the production React/Worker visual harness.
    for index in range(len(clean)):
        run(
            [
                "-y",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-s",
                f"{width}x{height}",
                "-i",
                "pipe:0",
                "-frames:v",
                "1",
                folder / f"{name}-frame-{index}.png",
            ],
            marked[index].tobytes(),
        )
    return {
        "case": name,
        "resolution": [width, height],
        "frames": len(clean),
        "fps": FPS,
        "box": box,
        "feather": feather,
        "radius": radius,
        "before": {**metrics(clean, before, box), "seconds": before_seconds},
        "after": {
            **metrics(clean, after, box),
            "seconds": after_seconds,
            "outside_max": outside_max,
            "patch_bytes": disk_bytes,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(24)
    texture = rng.integers(20, 230, (112, 292, 3), dtype=np.uint8)
    clean = np.stack([texture[:, i * 3 : i * 3 + 192] for i in range(24)])
    clean[12:] = 255 - clean[12:]
    rows = [
        evaluate(
            args.output, "texture-cut", clean, {"x": 76, "y": 40, "w": 18, "h": 24}
        )
    ]
    if args.input:
        raw = run(
            [
                "-i",
                args.input,
                "-vf",
                "fps=12,scale=640:360",
                "-frames:v",
                "24",
                "-pix_fmt",
                "rgb24",
                "-f",
                "rawvideo",
                "pipe:1",
            ]
        )
        real = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3)
        rows.append(
            evaluate(
                args.output,
                "real-natural",
                real,
                {"x": 306, "y": 236, "w": 18, "h": 24},
                feather=6,
            )
        )
        pan = np.stack([np.roll(frame, i * 3, axis=1) for i, frame in enumerate(real)])
        pan[12:] = 255 - pan[12:]
        rows.append(
            evaluate(
                args.output,
                "real-pan-cut",
                pan,
                {"x": 340, "y": 236, "w": 18, "h": 24},
                feather=6,
            )
        )
    (args.output / "metrics.json").write_text(
        json.dumps(rows, indent=2), encoding="utf-8"
    )
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
