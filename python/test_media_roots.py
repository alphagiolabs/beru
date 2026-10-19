#!/usr/bin/env python3
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from media_paths import _validated_job_media# noqa: E402


def _write_png(path: Path) -> None:
    path.write_bytes(b"\x89PNG\r\n\x1a\n")


def test_image_assets_without_asset_roots_are_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / "clip.mp4"
        image = Path(tmp) / "logo.png"
        video.write_bytes(b"fake")
        _write_png(image)
        cases = {
            "empty asset_roots, image operation": {
                "asset_roots": [],
                "operations": [{"mode": "image", "image_path": str(image)}],
            },
            "missing asset_roots, watermark image": {
                "operations": [],
                "watermark": {"type": "image", "imagePath": str(image)},
            },
        }
        for label, fields in cases.items():
            job = {"input_path": str(video), "input_root": str(tmp), **fields}
            try:
                _validated_job_media(job, require_output=False)
                raise AssertionError(f"expected ValueError for {label}")
            except ValueError as exc:
                assert "asset_roots" in str(exc).lower(), label


def test_nonempty_asset_roots_accepts_image_under_root():
    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / "clip.mp4"
        image = Path(tmp) / "logo.png"
        video.write_bytes(b"fake")
        _write_png(image)
        job = {
            "input_path": str(video),
            "input_root": str(tmp),
            "asset_roots": [str(tmp)],
            "operations": [{"mode": "image", "image_path": str(image)}],
        }
        validated = _validated_job_media(job, require_output=False)
        assert os.path.isfile(validated["operations"][0]["image_path"])


def test_font_path_still_allows_parent_fallback_without_asset_roots():
    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / "clip.mp4"
        font = Path(tmp) / "Custom.ttf"
        video.write_bytes(b"fake")
        font.write_bytes(b"otf-fake")
        job = {
            "input_path": str(video),
            "input_root": str(tmp),
            "asset_roots": [],
            "operations": [{"mode": "text", "text": "Hi", "font_path": str(font)}],
        }
        validated = _validated_job_media(job, require_output=False)
        assert os.path.isfile(validated["operations"][0]["font_path"])


if __name__ == "__main__":
    test_image_assets_without_asset_roots_are_rejected()
    test_nonempty_asset_roots_accepts_image_under_root()
    test_font_path_still_allows_parent_fallback_without_asset_roots()
    print("ALL PASSED")
