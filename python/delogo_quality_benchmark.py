"""Reproducible logo quality/cost comparisons on clean real or generated footage.

python python/delogo_quality_benchmark.py --input clean.mp4 --output .tmp/delogo/results
An optional --baseline points to a saved delogo_chains.py before editing.
Metrics use lossless frames; review videos use H.264 only for playback.
"""

import argparse
import importlib.util
import json
import statistics
import subprocess
import time
from pathlib import Path

import numpy as np

from delogo_chains import _build_delogo_chain
from processor import find_ffmpeg

FFMPEG = find_ffmpeg()
FPS, FRAMES = 12, 24


def run(args):
    result = subprocess.run([str(a) for a in (FFMPEG, "-v", "error", *args)],
                            capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-3000:])
    return result.stdout


def graph(builder, op, width, height):
    return builder(op, None, 0, width, height)


def pixels(path, width, height, filters=None):
    args = ["-i", path]
    if filters:
        args += ["-filter_complex", filters, "-map", "[tmp0]"]
    raw = run([*args, "-frames:v", FRAMES, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"])
    return np.frombuffer(raw, np.uint8).reshape(-1, height, width, 3).astype(np.int16)


def metrics(truth, output, box, feather):
    x, y, w, h = (box[k] for k in ("x", "y", "w", "h"))
    error = output.astype(float) - truth
    core = np.zeros(truth.shape[1:3], bool)
    core[y:y+h, x:x+w] = True
    ring = np.zeros_like(core)
    ring[max(0, y-feather):y+h+feather, max(0, x-feather):x+w+feather] = True
    outside = ~ring.copy()
    ring[core] = False
    seam = core.copy()
    seam[y+2:y+h-2, x+2:x+w-2] = False
    detail = np.diff(output[:, y:y+h, x:x+w].astype(float), axis=2)
    clean_detail = np.diff(truth[:, y:y+h, x:x+w].astype(float), axis=2)
    return {
        "core_mae": float(np.abs(error[:, core]).mean()),
        "ring_mae": float(np.abs(error[:, ring]).mean()),
        "seam_mae": float(np.abs(error[:, seam]).mean()),
        "temporal_error_mae": float(np.abs(np.diff(error[:, core], axis=0)).mean()),
        "detail_error_mae": float(np.abs(detail-clean_detail).mean()),
        "outside_max": int(np.abs(error[:, outside]).max()),
        "frames": len(output),
    }


def cost(path, filters):
    args = ["-threads", "2", "-i", path, "-filter_complex_threads", "2",
            "-filter_complex", filters, "-map", "[tmp0]", "-frames:v", FRAMES,
            "-an", "-f", "null", "-"]
    run(args)
    samples = []
    for _ in range(3):
        start = time.perf_counter()
        run(args)
        samples.append(time.perf_counter() - start)
    return statistics.median(samples)


def video(path, output, filters=None):
    args = ["-y", "-i", path]
    if filters:
        args += ["-filter_complex", filters, "-map", "[tmp0]"]
    run([*args, "-frames:v", FRAMES, "-an", "-c:v", "libx264", "-crf", "16",
         "-pix_fmt", "yuv420p", "-preset", "fast", output])


def tune_existing(output):
    """Compare settings against the same clean ROI, without changing presets."""
    existing = json.loads((output / "metrics.json").read_text(encoding="utf-8"))
    settings = [("blur", strength, feather, 0)
                for strength in (20, 30, 45, 60) for feather in (2, 6)]
    settings += [("inpaint", 60, feather, expansion)
                 for feather in (2, 6, 12) for expansion in (0, 2)]
    rows = []
    for name in ("real-uniform", "real-detail", "real-moving"):
        case = next(row for row in existing if row["case"] == name)
        width, height, box = case["width"], case["height"], case["box"]
        truth = pixels(output / f"{name}-truth.mkv", width, height)
        for method, strength, feather, expansion in settings:
            selected = {"x": box["x"]-expansion, "y": box["y"]-expansion,
                        "w": box["w"]+2*expansion, "h": box["h"]+2*expansion}
            op = {"mode": "delogo", "region": selected, "delogo_method": method,
                  "edge_feather": feather, "blur_strength": strength}
            fc = graph(_build_delogo_chain, op, width, height)
            result = metrics(truth, pixels(output / f"{name}-input.mkv", width, height, fc),
                             box, 16)
            result.update(case=name, operation=op, expansion=expansion)
            rows.append(result)
            print(json.dumps(result), flush=True)
        del truth
    (output / "tuning.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--tune", action="store_true", help="Sweep settings on existing real cases")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.tune:
        tune_existing(args.output)
        return
    builders = {"after": _build_delogo_chain}
    if args.baseline:
        spec = importlib.util.spec_from_file_location("baseline_delogo", args.baseline)
        baseline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(baseline)
        builders = {"before": baseline._build_delogo_chain, **builders}

    cases = [
        ("uniform-small", 320, 180, "uniform", False, .12),
        ("texture-small", 320, 180, "texture", False, .12),
        ("texture-large-moving", 640, 360, "texture", True, .24),
        ("texture-720", 1280, 720, "texture", False, .08),
    ]
    if args.input:
        cases += [("real-uniform", 640, 360, "real-flat", False, .12),
                  ("real-detail", 640, 360, "real-detail", False, .12),
                  ("real-moving", 640, 360, "real-detail", True, .18),
                  ("real-portrait", 360, 640, "real-detail", False, .12)]
    rows = []
    for name, width, height, kind, moving, size in cases:
        truth_path = args.output / f"{name}-truth.mkv"
        source_args = (["-f", "lavfi", "-i", f"color=c=0x808080:s={width}x{height}:r={FPS}"]
                       if kind == "uniform" else
                       ["-f", "lavfi", "-i", f"testsrc2=s={width}x{height}:r={FPS}"]
                       if kind == "texture" else ["-ss", "1", "-i", args.input])
        resize = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
        run(["-y", *source_args, "-vf", f"{resize},fps={FPS}",
             "-frames:v", FRAMES, "-an", "-c:v", "ffv1", "-pix_fmt", "yuv420p", truth_path])
        x = int(width * (.12 if kind == "real-flat" else .44)) | 1
        y = int(height * (.15 if kind == "real-flat" else .68)) | 1
        w = int(width * size) | 1
        h = max(13, int(w * .38)) | 1
        if moving:
            w += 30
        box = {"x": x, "y": y, "w": w, "h": h}
        logo_path = args.output / f"{name}-input.mkv"
        lx = f"{x+4}+14*(1+sin(t*3))" if moving else str(x+4)
        run(["-y", "-i", truth_path, "-vf",
             f"drawtext=text='LOGO':font='Arial':fontsize={h-8}:fontcolor=white:"
             f"borderw=2:bordercolor=black:x='{lx}':y={y+4}",
             "-an", "-c:v", "ffv1", "-pix_fmt", "yuv420p", logo_path])
        truth = pixels(truth_path, width, height)
        video(logo_path, args.output / f"{name}-input.mp4")
        for method in ("inpaint", "blur", "mirror"):
            op = {"mode": "delogo", "region": box, "delogo_method": method,
                  "edge_feather": 6, "blur_strength": 60, "mirror_side": "right"}
            for version, builder in builders.items():
                fc = graph(builder, op, width, height)
                result = metrics(truth, pixels(logo_path, width, height, fc), box, 8)
                result.update(case=name, method=method, version=version,
                              width=width, height=height, box=box, operation=op,
                              seconds=cost(logo_path, fc))
                rows.append(result)
                print(json.dumps(result), flush=True)
                video(logo_path, args.output / f"{name}-{method}-{version}.mp4", fc)
        (args.output / "metrics.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
        del truth

    # Resolution sweep measures the actual filter stage without huge RGB arrays.
    for width, height in ((1920, 1080), (3836, 2160)):
        path = args.output / f"cost-{width}.mkv"
        run(["-y", "-f", "lavfi", "-i", f"testsrc2=s={width}x{height}:r={FPS}",
             "-frames:v", FRAMES, "-an", "-c:v", "ffv1", path])
        for method in ("inpaint", "blur"):
            op = {"mode": "delogo", "delogo_method": method, "edge_feather": 6,
                  "blur_strength": 60, "region": {"x": width//2, "y": height//2,
                  "w": width//12, "h": height//20}}
            for version, builder in builders.items():
                result = dict(case=f"cost-{width}", method=method, version=version,
                              width=width, height=height,
                              seconds=cost(path, graph(builder, op, width, height)))
                rows.append(result)
                print(json.dumps(result), flush=True)
    (args.output / "metrics.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
