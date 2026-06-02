#!/usr/bin/env python3
"""Benchmark export on prueba.mp4 (run from repo root)."""
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

import processor  # noqa: E402

FFMPEG = ROOT / "src-tauri" / "bin" / "ffmpeg.exe"
INPUT = ROOT / "prueba.mp4"
OUT_DIR = ROOT / "tmp" / "benchmark"


def make_job(name, operations, encode_profile="balanced"):
    return {
        "id": 0,
        "input_path": str(INPUT),
        "output_path": str(OUT_DIR / name),
        "width": 1280,
        "height": 720,
        "video_duration": 196.96,
        "video_codec": "hevc",
        "pix_fmt": "yuv420p",
        "frame_rate": 25,
        "audio_codec": "aac",
        "encode_profile": encode_profile,
        "operations": operations,
    }


def run_case(label, job):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(job["output_path"])
    if out.exists():
        out.unlink()
    t0 = time.perf_counter()
    result = processor.process_jobs([job], str(FFMPEG), max_workers=1)
    elapsed = time.perf_counter() - t0
    ok = result.get("succeeded") == 1 and out.exists()
    size_mb = out.stat().st_size / (1024 * 1024) if ok else 0
    print(f"[{label}] ok={ok} time={elapsed:.1f}s size={size_mb:.2f}MB result={result}")
    return ok, elapsed


def main():
    if not FFMPEG.exists():
        print("ffmpeg not found:", FFMPEG)
        sys.exit(1)
    if not INPUT.exists():
        print("prueba.mp4 not found:", INPUT)
        sys.exit(1)

    processor.FFMPEG = str(FFMPEG)
    processor.FFPROBE = str(FFMPEG)

    text_op = {
        "mode": "text",
        "text": "BERU benchmark",
        "font_size": 32,
        "font_color": "white",
        "font_family": "Arial",
        "region": {"x": 40, "y": 40, "w": 400, "h": 80},
    }
    delogo_temporal = {
        "mode": "delogo",
        "delogo_method": "temporal",
        "temporal_radius": 3,
        "edge_feather": 6,
        "region": {"x": 1000, "y": 20, "w": 200, "h": 80},
    }

    cases = [
        ("text_only", make_job("prueba_text.mp4", [text_op])),
        ("delogo_optimized", make_job("prueba_delogo.mp4", [delogo_temporal])),
        ("text_plus_delogo", make_job("prueba_both.mp4", [text_op, delogo_temporal])),
    ]

    print("encoder:", processor.detect_hw_encoder(str(FFMPEG)) or "libx264")
    print("input:", INPUT)
    print("---")

    all_ok = True
    for label, job in cases:
        ok, _ = run_case(label, job)
        all_ok = all_ok and ok

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()