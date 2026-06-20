#!/usr/bin/env python3
"""Unit tests for shared operation helpers (op_shared._coerce_float)."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from op_shared import _coerce_float  # noqa: E402


def test_zero_is_preserved():
    # Regression: the old `value or 1` pattern turned 0 into 1.
    assert _coerce_float(0, 1.0, 0.0, 1.0) == 0.0
    assert _coerce_float(0.0, 1.0, 0.0, 1.0) == 0.0
    assert _coerce_float("0", 1.0, 0.0, 1.0) == 0.0


def test_none_uses_default():
    assert _coerce_float(None, 1.0, 0.0, 1.0) == 1.0


def test_invalid_uses_default():
    assert _coerce_float("abc", 1.0, 0.0, 1.0) == 1.0
    assert _coerce_float([], 1.0, 0.0, 1.0) == 1.0


def test_clamping():
    assert _coerce_float(-1, 1.0, 0.0, 1.0) == 0.0
    assert _coerce_float(1.5, 1.0, 0.0, 1.0) == 1.0
    assert _coerce_float(-0.5, 1.0, 0.0, 1.0) == 0.0


def test_passthrough_in_range():
    assert _coerce_float(0.35, 1.0, 0.0, 1.0) == 0.35
    assert _coerce_float("0.5", 1.0, 0.0, 1.0) == 0.5


def main():
    tests = [
        test_zero_is_preserved,
        test_none_uses_default,
        test_invalid_uses_default,
        test_clamping,
        test_passthrough_in_range,
    ]
    failed = 0
    for t in tests:
        name = t.__name__
        try:
            t()
            print(f"  [OK] {name}")
        except Exception as e:
            print(f"  [FAIL] {name}: {e}")
            failed += 1
    print(f"\n{'ALL PASSED' if not failed else f'{failed} FAILED'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
