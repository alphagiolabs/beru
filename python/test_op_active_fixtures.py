"""Load resources/op-active-fixtures.json and assert the Processor's
time-window semantics match JS ``isOpActive`` (src/utils/operation.js).

The Python side has no per-``t`` predicate: the truth table is replayed from
the two production artifacts that encode it — ``_is_op_time_disabled`` (op
skipped entirely) and the ``enable=`` clause ``_build_enable_clause`` emits.
"""

import json
import re
import unittest
from pathlib import Path

from op_shared import _build_enable_clause, _is_op_time_disabled

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "resources" / "op-active-fixtures.json"

_CLAUSE = re.compile(r"enable=(between|gte|lte)\(t\\,([^)]+)\)")


def _op_active_at(op, t):
    """Evaluate at time ``t`` what the emitted enable clause makes FFmpeg do."""
    if _is_op_time_disabled(op):
        return False
    clause = _build_enable_clause(op)
    if not clause:
        return True
    match = _CLAUSE.fullmatch(clause)
    assert match, f"unexpected clause shape: {clause!r}"
    bounds = [float(p) for p in match.group(2).split("\\,")]
    func = match.group(1)
    if func == "between":
        return bounds[0] <= t <= bounds[1]
    if func == "gte":
        return t >= bounds[0]
    return t <= bounds[0]


def _to_job_op(case):
    """Job ops carry snake_case bounds; absent key means unbounded."""
    op = {}
    if "start" in case:
        op["start_time"] = case["start"]
    if "end" in case:
        op["end_time"] = case["end"]
    return op


class OpActiveFixturesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with FIXTURES.open(encoding="utf-8") as handle:
            cls.contract = json.load(handle)

    def test_versioned_contract(self):
        self.assertEqual(self.contract["version"], 1)
        self.assertGreater(len(self.contract["active_cases"]), 0)

    def test_active_cases(self):
        for case in self.contract["active_cases"]:
            with self.subTest(case["id"]):
                active = _op_active_at(_to_job_op(case), case["t"])
                self.assertEqual(active, case["expected"])


if __name__ == "__main__":
    unittest.main()
