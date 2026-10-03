"""Lossless comparisons of spatial Inpaint against clean complex backgrounds."""

import argparse
import json
import tempfile
import time
from pathlib import Path

import numpy as np

from delogo_chains import _build_delogo_chain
from filters import build_filter_complex
from temporal_pipeline import TemporalPatchResolver
from temporal_quality_benchmark import FFMPEG, FPS, encode, metrics, render, run


def evaluate(folder, name, clean, box, feather):
    _, height, width, _ = clean.shape
    x, y, w, h = (box[k] for k in ("x", "y", "w", "h"))
    marked = clean.copy()
    marked[:, y : y + h, x : x + w] = 255
    path = folder / f"{name}-input.mkv"
    encode(path, marked)
    op = {
        "mode": "delogo",
        "delogo_method": "inpaint",
        "region": box,
        "edge_feather": feather,
    }
    started = time.perf_counter()
    graph = _build_delogo_chain(op, None, 0, width, height, source_pix_fmt="yuv444p")
    before = render(path, graph, "[tmp0]", [], width, height)
    before_time = time.perf_counter() - started
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(dir=folder) as directory:
        resolver = TemporalPatchResolver(
            str(path), directory, FFMPEG, FPS, source_format="yuv444p"
        )
        graph, label, media = build_filter_complex(
            [op], width, height, source_pix_fmt="yuv444p", temporal_resolver=resolver
        )
        after = render(path, graph, label, media, width, height)
        disk = sum(Path(p).stat().st_size for p in media)
    after_time = time.perf_counter() - started
    original = render(path, None, None, [], width, height)
    outer = np.ones((height, width), bool)
    outer[
        max(0, y - feather) : y + h + feather, max(0, x - feather) : x + w + feather
    ] = False
    assert len(after) == len(clean)
    outside = int(np.abs(after[:, outer].astype(int) - original[:, outer]).max())
    assert outside == 0
    panels = np.concatenate([clean, marked, before, after], axis=2)
    encode(folder / f"{name}-marked.mp4", marked, review=True)
    encode(folder / f"{name}-comparison.mp4", panels, review=True)
    for index in (0, 11, 12, 22):
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
    return {
        "case": name,
        "resolution": [width, height],
        "box": box,
        "feather": feather,
        "frames": len(clean),
        "fps": FPS,
        "before": {**metrics(clean, before, box), "seconds": before_time},
        "after": {
            **metrics(clean, after, box),
            "seconds": after_time,
            "outside_max": outside,
            "patch_bytes": disk,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    yy, xx = np.mgrid[:112, :192]
    pattern = (((xx + yy // 2) % 12 < 3) * 95 + (yy % 8 < 2) * 35 + 45).astype(np.uint8)
    cloth = np.stack([pattern] * 3, axis=-1)
    texture = np.stack([np.roll(cloth, n, axis=1) for n in range(24)])
    texture[12:] = 255 - texture[12:]
    edge = np.where(
        (yy - xx // 3 > 25)[..., None],
        np.array([35, 65, 120]),
        np.array([175, 200, 210]),
    ).astype(np.uint8)
    cases = [
        ("woven-cut", texture, {"x": 76, "y": 40, "w": 18, "h": 24}, 0),
        (
            "slanted-edge",
            np.stack([edge] * 24),
            {"x": 76, "y": 40, "w": 18, "h": 24},
            6,
        ),
    ]
    ly, lx = np.mgrid[:240, :360]
    large_pattern = (((lx + ly // 2) % 12 < 3) * 95 + (ly % 8 < 2) * 35 + 45).astype(
        np.uint8
    )
    large_cloth = np.stack([large_pattern] * 3, axis=-1)
    cases.append(
        (
            "woven-large",
            np.stack([np.roll(large_cloth, n, axis=1) for n in range(24)]),
            {"x": 120, "y": 84, "w": 108, "h": 72},
            6,
        )
    )
    hidden = np.full((24, 112, 192, 3), 90, np.uint8)
    hidden[:, 46:58, 81:89] = [170, 40, 60]
    cases.append(("hidden-object", hidden, {"x": 76, "y": 40, "w": 18, "h": 24}, 6))
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
        clean = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3)
        cases += [
            ("real-detail-small", clean, {"x": 306, "y": 236, "w": 18, "h": 24}, 6),
            ("real-detail-large", clean, {"x": 278, "y": 215, "w": 54, "h": 48}, 6),
        ]
    rows = []
    for name, clean, box, feather in cases:
        result = evaluate(args.output, name, clean, box, feather)
        rows.append(result)
        print(json.dumps(result), flush=True)
    (args.output / "metrics.json").write_text(
        json.dumps(rows, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
