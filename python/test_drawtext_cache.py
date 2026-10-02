"""Regression: the drawtext memo cache must be ON by default.

The flag used to be opt-in (`BERU_DRAWTEXT_CACHE` defaulted to "0"), but
nothing in the repo or the spawned child env ever set it, so every text op
re-ran wrap + autofit + filter rendering on each retry and second pass.
`build_drawtext` depends on the op and FFmpeg capabilities, so the default is on;
the env var remains as an explicit opt-out.
"""

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

import filters  # noqa: E402
import processor  # noqa: E402


def _text_op(**overrides):
    op = {
        "mode": "text",
        "text": "Hola",
        "region": {"x": 0, "y": 0, "w": 320, "h": 200},
        "font_size": 32,
    }
    op.update(overrides)
    return op


def _reset_flag():
    filters._DRAWTEXT_CACHE_ENABLED = None


def test_cache_enabled_by_default():
    _reset_flag()
    try:
        with patch.dict(processor.os.environ, {}, clear=False):
            processor.os.environ.pop("BERU_DRAWTEXT_CACHE", None)
            assert processor._drawtext_cache_enabled() is True
    finally:
        _reset_flag()


def test_env_opt_out_disables_cache():
    _reset_flag()
    try:
        for off in ("0", "false", "no", "off"):
            _reset_flag()
            with patch.dict(processor.os.environ, {"BERU_DRAWTEXT_CACHE": off}):
                assert processor._drawtext_cache_enabled() is False, off
    finally:
        _reset_flag()


def test_identical_op_is_memoized():
    processor._DRAWTEXT_CACHE.clear()
    op = _text_op(text="Memoized", border_width=7)
    with patch.object(filters, "_layout_export_text", wraps=filters._layout_export_text) as layout:
        first = processor.build_drawtext(op)
        assert processor.build_drawtext(dict(op)) == first
    assert layout.call_count == 1


if __name__ == "__main__":
    test_cache_enabled_by_default()
    test_env_opt_out_disables_cache()
    test_identical_op_is_memoized()
    print("ALL PASSED")
