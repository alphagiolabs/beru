"""Regression: font caches are bounded by the run, not the worker lifetime.

The job worker stays alive across runs. Without `reset_caches` a font
installed after the first run stays invisible, and a font deleted between
runs leaves a `fontfile` cache hit pointing at a missing file and fails jobs.
"""

import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

import fonts as fonts_module  # noqa: E402
import filters  # noqa: E402
import processor  # noqa: E402


def test_deleted_fontfile_reverifies_on_cache_hit():
    with tempfile.TemporaryDirectory() as tmp:
        font = Path(tmp) / "ghost.ttf"
        font.write_bytes(b"x")
        catalogue = {"ghost": (str(font), "ghost")}
        with patch.object(fonts_module, "get_system_fonts", return_value=catalogue):
            fonts_module.reset_caches()
            assert fonts_module._resolve_font("ghost")[0] == "fontfile"
            font.unlink()
            resolved = fonts_module._resolve_font("ghost")
    assert resolved == ("font", "ghost", False), resolved


def test_reset_exposes_font_installed_between_runs():
    with tempfile.TemporaryDirectory() as tmp:
        font = Path(tmp) / "newfont.ttf"
        font.write_bytes(b"x")
        before = {"arial": (str(font), "arial")}
        after = {"newfont": (str(font), "newfont")}
        with patch.object(fonts_module, "get_system_fonts") as provider:
            provider.return_value = before
            fonts_module.reset_caches()
            assert fonts_module._resolve_font("newfont") == ("font", "newfont", False)
            provider.return_value = after
            fonts_module.reset_caches()
            resolved = fonts_module._resolve_font("newfont")
    assert resolved[0] == "fontfile", resolved


def test_process_jobs_rescans_fonts_every_run():
    registry_calls = []

    def _no_registry_fonts():
        registry_calls.append(1)
        return {}

    job = {
        "id": 0,
        "input_path": "in.mp4",
        "output_path": "out.mp4",
        "operations": [{"mode": "text", "text": "x"}],
        "encode_profile": "fast",
    }
    batch = {
        "succeeded": 0,
        "failed": 0,
        "cancelled": 0,
        "completed": 0,
        "results": {},
        "failed_jobs": [],
    }

    with patch.object(fonts_module, "FONT_DIRS", []), patch.object(
        fonts_module, "_windows_registry_fonts", side_effect=_no_registry_fonts
    ), patch.object(processor, "_execute_batch", return_value=batch), patch.object(
        processor, "detect_hw_encoder", return_value=None
    ):
        processor.process_jobs([job], "ffmpeg")
        processor.process_jobs([job], "ffmpeg")

    assert len(registry_calls) == 2, registry_calls


def test_cached_drawtext_falls_back_when_its_font_is_deleted():
    with tempfile.TemporaryDirectory() as tmp:
        font = Path(tmp) / "ghost.ttf"
        font.write_bytes(b"x")
        catalogue = {"ghost": (str(font), "ghost")}
        op = {"text": "Hello", "font_family": "ghost"}
        filters._DRAWTEXT_CACHE.clear()
        fonts_module.reset_caches()
        with patch.object(fonts_module, "get_system_fonts", return_value=catalogue), patch.object(
            filters, "_drawtext_supports", return_value=False
        ):
            assert "fontfile=" in filters.build_drawtext(op)
            font.unlink()
            assert "font=ghost" in filters.build_drawtext(op)
    filters._DRAWTEXT_CACHE.clear()


def test_cached_drawtext_uses_a_font_installed_between_runs():
    with tempfile.TemporaryDirectory() as tmp:
        font = Path(tmp) / "newfont.ttf"
        font.write_bytes(b"x")
        op = {"text": "Hello", "font_family": "newfont"}
        filters._DRAWTEXT_CACHE.clear()
        fonts_module.reset_caches()
        with patch.object(fonts_module, "get_system_fonts") as provider, patch.object(
            filters, "_drawtext_supports", return_value=False
        ):
            provider.return_value = {}
            assert "font=newfont" in filters.build_drawtext(op)
            provider.return_value = {"newfont": (str(font), "newfont")}
            fonts_module.reset_caches()
            assert "fontfile=" in filters.build_drawtext(op)
    filters._DRAWTEXT_CACHE.clear()


if __name__ == "__main__":
    test_deleted_fontfile_reverifies_on_cache_hit()
    test_reset_exposes_font_installed_between_runs()
    test_process_jobs_rescans_fonts_every_run()
    test_cached_drawtext_falls_back_when_its_font_is_deleted()
    test_cached_drawtext_uses_a_font_installed_between_runs()
    print("ALL PASSED")
