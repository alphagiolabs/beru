#!/usr/bin/env python3
"""Batch summary must keep cancelled separate from failed."""
import ast
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = (HERE / "processor.py").read_text(encoding="utf-8")


def test_summary_return_keeps_cancelled_separate():
    assert "failed + cancelled" not in SRC
    assert '"cancelled": cancelled' in SRC or "'cancelled': cancelled" in SRC


def test_summary_dict_shape_in_return():
    tree = ast.parse(SRC)
    found = False
    for node in ast.walk(tree):
        if not isinstance(node, ast.Return):
            continue
        val = node.value
        if not isinstance(val, ast.Dict):
            continue
        keys = []
        for k in val.keys:
            if isinstance(k, ast.Constant):
                keys.append(k.value)
        if set(keys) >= {"total", "succeeded", "failed", "cancelled"}:
            found = True
            break
    assert found, "Expected process_jobs to return total/succeeded/failed/cancelled"


def main():
    test_summary_return_keeps_cancelled_separate()
    test_summary_dict_shape_in_return()
    print("ALL PASSED")


if __name__ == "__main__":
    main()
