"""Load resources/text-layout-fixtures.json and assert Python helpers match."""

import json
import unittest
from pathlib import Path

from text_layout_helpers import (
    _fit_font_size,
    _layout_export_text,
    _text_box_pad,
    _text_layout_bounds,
    _truncate_text,
    _wrap_text_to_width,
)

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
        self.assertGreater(len(self.contract["fit_cases"]), 0)
        self.assertGreater(len(self.contract["truncate_cases"]), 0)
        self.assertGreater(len(self.contract["layout_cases"]), 0)

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

    def test_fit_cases(self):
        for case in self.contract["fit_cases"]:
            with self.subTest(case["id"]):
                size = _fit_font_size(
                    case["text"],
                    case["region_w"],
                    case["region_h"],
                    case["font_size"],
                    case["line_height"],
                    case["wrap"],
                )
                self.assertEqual(size, case["expected"]["font_size"])

    def test_truncate_cases(self):
        for case in self.contract["truncate_cases"]:
            with self.subTest(case["id"]):
                truncated = _truncate_text(
                    case["text"], case["max_width_px"], case["font_size"], case["mode"]
                )
                self.assertEqual(truncated, case["expected"]["truncated"])

    def test_layout_cases(self):
        for case in self.contract["layout_cases"]:
            with self.subTest(case["id"]):
                laid = _layout_export_text(
                    case["text"],
                    case["region_w"],
                    case["region_h"],
                    font_size=case["font_size"],
                    line_height=case["line_height"],
                    text_wrap=case["text_wrap"],
                    auto_fit=case["auto_fit"],
                    truncate=case["truncate"],
                )
                self.assertEqual(laid, case["expected"])


if __name__ == "__main__":
    unittest.main()
