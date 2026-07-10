"""Load resources/text-layout-fixtures.json and assert Python helpers match."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from text_layout_helpers import _text_box_pad, _text_layout_bounds, _wrap_text_to_width

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "resources" / "text-layout-fixtures.json"


class TextLayoutFixturesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with FIXTURES.open(encoding="utf-8") as handle:
            cls.contract = json.load(handle)

    def test_versioned_contract(self):
        self.assertEqual(self.contract["version"], 1)
        self.assertGreater(len(self.contract["bounds_cases"]), 0)
        self.assertGreater(len(self.contract["wrap_cases"]), 0)

    def test_bounds_cases(self):
        for case in self.contract["bounds_cases"]:
            with self.subTest(case["id"]):
                pad = _text_box_pad(case["op"])
                bounds = _text_layout_bounds(case["region"], case["safe_margin"], pad)
                self.assertEqual(pad, case["expected"]["box_pad"])
                self.assertEqual(bounds, case["expected"]["bounds"])

    def test_wrap_cases(self):
        for case in self.contract["wrap_cases"]:
            with self.subTest(case["id"]):
                wrapped = _wrap_text_to_width(
                    case["text"], case["max_width_px"], case["font_size"]
                )
                self.assertEqual(wrapped, case["expected"]["wrapped"])


if __name__ == "__main__":
    unittest.main()
