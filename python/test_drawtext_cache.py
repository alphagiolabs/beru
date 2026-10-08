"""Regression: the drawtext memo cache must be ON by default.

The flag used to be opt-in (`BERU_DRAWTEXT_CACHE` defaulted to "0"), but
nothing in the repo or the spawned child env ever set it, so every text op
re-ran wrap + autofit + filter rendering on each retry and second pass.
`build_drawtext` depends on the op and FFmpeg capabilities, so the default is on;
the env var remains as an explicit opt-out.
"""

import sys
import threading
from concurrent.futures import ThreadPoolExecutor
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


def test_hit_survives_eviction_horizon():
    """A hit re-enqueues the key, so hot entries outlive the eviction cap."""
    processor._DRAWTEXT_CACHE.clear()
    saved_max = filters._DRAWTEXT_CACHE_MAX
    filters._DRAWTEXT_CACHE_MAX = 4
    try:
        hot_op = _text_op(text="Hot")
        processor.build_drawtext(hot_op)
        for i in range(3):
            processor.build_drawtext(_text_op(text=f"Filler {i}"))
        with patch.object(filters, "_layout_export_text", wraps=filters._layout_export_text) as layout:
            processor.build_drawtext(dict(hot_op))
            for i in range(3):
                processor.build_drawtext(_text_op(text=f"Cold {i}"))
            layout.reset_mock()
            processor.build_drawtext(dict(hot_op))
        assert layout.call_count == 0
    finally:
        filters._DRAWTEXT_CACHE_MAX = saved_max
        processor._DRAWTEXT_CACHE.clear()


def test_cache_hit_during_eviction_keeps_both_filters_valid():
    eviction_started = threading.Event()
    promotion_paused = threading.Event()
    eviction_finished = threading.Event()
    filters._DRAWTEXT_CACHE.clear()
    with patch.object(filters, "_DRAWTEXT_CACHE_MAX", 4), patch.object(
        filters, "_drawtext_supports", return_value=False
    ):
        for i in range(3):
            filters.build_drawtext(_text_op(text=f"Filler {i}"))
        hot_op = _text_op(text="Hot")
        hot_filter = filters.build_drawtext(hot_op)
        hot_key = next(key for key, value in filters._DRAWTEXT_CACHE.items() if value == hot_filter)

        class PausedEvictionCache(dict):
            def __iter__(self):
                iterator = super().__iter__()
                eviction_started.set()
                promotion_paused.wait(0.2)
                return iterator

            def pop(self, key, default=None):
                value = super().pop(key, default)
                if key == hot_key:
                    promotion_paused.set()
                    assert eviction_finished.wait(5), "eviction did not finish"
                return value

        def cold_filter():
            try:
                return filters.build_drawtext(_text_op(text="Cold"))
            finally:
                eviction_finished.set()

        def concurrent_hit():
            assert eviction_started.wait(5), "eviction did not start"
            return filters.build_drawtext(hot_op)

        with patch.object(filters, "_DRAWTEXT_CACHE", PausedEvictionCache(filters._DRAWTEXT_CACHE)):
            with ThreadPoolExecutor(max_workers=2) as workers:
                hit = workers.submit(concurrent_hit)
                cold = workers.submit(cold_filter)
                assert "Cold" in cold.result(timeout=10)
                assert hit.result(timeout=10) == hot_filter
    filters._DRAWTEXT_CACHE.clear()


if __name__ == "__main__":
    test_cache_enabled_by_default()
    test_env_opt_out_disables_cache()
    test_identical_op_is_memoized()
    test_hit_survives_eviction_horizon()
    test_cache_hit_during_eviction_keeps_both_filters_valid()
    print("ALL PASSED")
