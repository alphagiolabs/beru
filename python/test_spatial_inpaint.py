"""Inpaint texture and edge continuity through export and the exact preview."""

import base64
import subprocess
import tempfile
from pathlib import Path

import numpy as np

import processor
from filters import build_filter_complex
from temporal_pipeline import TemporalPatchResolver, extra_media_input_args

FFMPEG = processor.find_ffmpeg()
processor.FFMPEG = FFMPEG
processor.FFPROBE = processor.find_ffprobe(FFMPEG)
WIDTH, HEIGHT, FPS = 192, 112, 12
BOX = {"x": 76, "y": 40, "w": 18, "h": 24}
OP = {"mode": "delogo", "delogo_method": "inpaint", "region": BOX, "edge_feather": 0}


def run(args, data=None):
    result = subprocess.run(
        [str(a) for a in [FFMPEG, "-v", "error", *args]],
        input=data,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")[-2000:]
    return result.stdout


def decode(path=None, data=None, depth="rgb24"):
    args = ["-i", path] if path else ["-f", "image2pipe", "-i", "pipe:0"]
    raw = run(
        [
            *args,
            "-fps_mode",
            "passthrough",
            "-pix_fmt",
            depth,
            "-f",
            "rawvideo",
            "pipe:1",
        ],
        data,
    )
    return np.frombuffer(raw, np.uint16 if depth == "rgb48le" else np.uint8).reshape(
        -1, HEIGHT, WIDTH, 3
    )


def export(src, directory, name, *, depth="yuv444p", resolver=True):
    patch = (
        TemporalPatchResolver(
            str(src), str(directory), FFMPEG, FPS, source_format=depth
        )
        if resolver
        else None
    )
    graph, label, media = build_filter_complex(
        [OP], WIDTH, HEIGHT, source_pix_fmt=depth, temporal_resolver=patch
    )
    args = ["-y", "-i", src]
    for path in media:
        args += extra_media_input_args(path)
    output = directory / f"{name}.mkv"
    run(
        [
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
            output,
        ]
    )
    return output


def main():
    yy, xx = np.mgrid[:HEIGHT, :WIDTH]
    pattern = (((xx + yy // 2) % 12 < 3) * 95 + (yy % 8 < 2) * 35 + 45).astype(np.uint8)
    cloth = np.stack([pattern, pattern, pattern], axis=-1)
    edge = np.where(
        (yy - xx // 3 > 25)[..., None],
        np.array([35, 65, 120]),
        np.array([175, 200, 210]),
    ).astype(np.uint8)
    truth = np.stack([np.roll(cloth, n, axis=1) for n in range(4)] + [edge] * 3)
    marked = truth.copy()
    marked[:, 40:64, 76:94] = 255
    with tempfile.TemporaryDirectory(prefix="beru-inpaint-test-") as tmp:
        directory = Path(tmp)
        src = directory / "marked.mkv"
        run(
            [
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
                "-c:v",
                "ffv1",
                "-pix_fmt",
                "yuv444p",
                src,
            ],
            marked.tobytes(),
        )
        result = decode(export(src, directory, "repaired"))
        assert len(result) == len(truth)
        error = np.abs(result[:, 40:64, 76:94].astype(float) - truth[:, 40:64, 76:94])
        print(f"Complex Inpaint: texture/edge MAE {error.mean():.3f}", flush=True)
        assert error[:4].mean() < 8, "Texture replaced by an interpolated smear"
        assert (
            error[4:].mean() < 8
        ), "Visible slanted edge fails to continue through the logo"
        exterior = np.ones((HEIGHT, WIDTH), bool)
        exterior[40:64, 76:94] = False
        original = decode(src)
        assert np.array_equal(
            result[:, exterior], original[:, exterior]
        ), "Inpaint degraded unrelated pixels"
        for frame in (0, 3, 4, 6):
            preview = processor.render_preview_frame(
                {"input_path": str(src), "timestamp": frame / FPS, "operations": [OP]}
            )
            assert preview.get("ok"), preview
            pixels = decode(
                data=base64.b64decode(preview["data_url"].split(",", 1)[1])
            )[0]
            assert (
                np.abs(pixels.astype(float) - result[frame]).mean() < 1
            ), "Exact preview differs from export"
        rng = np.random.default_rng(83)
        noise = rng.integers(20, 230, (HEIGHT, WIDTH + 90, 3), dtype=np.uint8)
        moving = np.stack([noise[:, n * 5 : n * 5 + WIDTH] for n in range(12)])
        occluded = moving.copy()
        occluded[:, 40:64, 76:94] = 255
        motion_src = directory / "moving.mkv"
        run(
            [
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
                "-c:v",
                "ffv1",
                "-pix_fmt",
                "yuv444p",
                motion_src,
            ],
            occluded.tobytes(),
        )
        restored = decode(export(motion_src, directory, "moving-repaired"))
        motion_error = np.abs(
            restored[:, 40:64, 76:94].astype(float) - moving[:, 40:64, 76:94]
        ).mean()
        assert motion_error < 12, (
            "Clean temporal references unused by Inpaint",
            motion_error,
        )
        stationary = directory / "stationary.mkv"
        run(
            [
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
                "-c:v",
                "ffv1",
                "-pix_fmt",
                "yuv444p10le",
                stationary,
            ],
            np.stack([occluded[0]] * 3).tobytes(),
        )
        repaired_path = export(
            stationary, directory, "stationary-repaired", depth="yuv444p10le"
        )
        fallback_path = export(
            stationary,
            directory,
            "stationary-baseline",
            depth="yuv444p10le",
            resolver=False,
        )
        repaired, fallback = decode(repaired_path), decode(fallback_path)
        assert (
            np.abs(
                repaired[:, 40:64, 76:94].astype(float) - fallback[:, 40:64, 76:94]
            ).mean()
            < 1
        ), "No reliable sample should preserve the spatial fallback"
        native_before = np.frombuffer(
            run(
                [
                    "-i",
                    stationary,
                    "-pix_fmt",
                    "yuv444p10le",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]
            ),
            np.uint16,
        ).reshape(-1, 3, HEIGHT, WIDTH)
        native_after = np.frombuffer(
            run(
                [
                    "-i",
                    repaired_path,
                    "-pix_fmt",
                    "yuv444p10le",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ]
            ),
            np.uint16,
        ).reshape(-1, 3, HEIGHT, WIDTH)
        assert np.array_equal(
            native_before[:, :, exterior], native_after[:, :, exterior]
        ), "Inpaint reduced exterior 10-bit precision"
    print("Spatial Inpaint: OK")


if __name__ == "__main__":
    main()
