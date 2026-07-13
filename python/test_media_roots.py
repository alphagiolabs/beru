#!/usr/bin/env python3
"""asset_roots must be non-empty for overlay/watermark images (fail closed)."""
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from processor import _validated_job_media  # noqa: E402


def _write_png(path: Path) -> None:
    path.write_bytes(b"\x89PNG\r\n\x1a\n")


def test_empty_asset_roots_rejects_image_path():
    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / "clip.mp4"
        image = Path(tmp) / "logo.png"
        video.write_bytes(b"fake")
        _write_png(image)
        job = {
            "input_path": str(video),
            "input_root": str(tmp),
            "asset_roots": [],
            "operations": [{"mode": "image", "image_path": str(image)}],
        }
        try:
            _validated_job_media(job, require_output=False)
            raise AssertionError("expected ValueError for empty asset_roots")
        except ValueError as exc:
            assert "asset_roots" in str(exc).lower()


def test_missing_asset_roots_rejects_watermark_image():
    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / "clip.mp4"
        image = Path(tmp) / "wm.png"
        video.write_bytes(b"fake")
        _write_png(image)
        job = {
            "input_path": str(video),
            "input_root": str(tmp),
            "operations": [],
            "watermark": {"type": "image", "imagePath": str(image)},
        }
        try:
            _validated_job_media(job, require_output=False)
            raise AssertionError("expected ValueError for missing asset_roots")
        except ValueError as exc:
            assert "asset_roots" in str(exc).lower()


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
    test_empty_asset_roots_rejects_image_path()
    test_missing_asset_roots_rejects_watermark_image()
    test_nonempty_asset_roots_accepts_image_under_root()
    test_font_path_still_allows_parent_fallback_without_asset_roots()
    print("ALL PASSED")
