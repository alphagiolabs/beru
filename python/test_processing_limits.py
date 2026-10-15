"""Assert clip_timing's timing limits match resources/processing-limits.json."""

import json
import unittest
from pathlib import Path

import clip_timing

ROOT = Path(__file__).resolve().parents[1]
LIMITS = json.loads((ROOT / "resources" / "processing-limits.json").read_text(encoding="utf-8"))


class ProcessingLimitsTest(unittest.TestCase):
    def test_constants_match_json(self):
        self.assertEqual(clip_timing.MIN_RATE, LIMITS["min_rate"])
        self.assertEqual(clip_timing.MAX_RATE, LIMITS["max_rate"])
        self.assertEqual(clip_timing.MIN_REPEAT_COUNT, LIMITS["min_repeat_count"])
        self.assertEqual(clip_timing.MAX_REPEAT_COUNT, LIMITS["max_repeat_count"])
        self.assertEqual(
            clip_timing.MAX_OUTPUT_DURATION_SECONDS, LIMITS["max_output_duration_seconds"]
        )

    def test_limits_are_accepted(self):
        self.assertEqual(
            clip_timing.playback_rate({"playback_rate": LIMITS["min_rate"]}),
            float(LIMITS["min_rate"]),
        )
        self.assertEqual(
            clip_timing.playback_rate({"playback_rate": LIMITS["max_rate"]}),
            float(LIMITS["max_rate"]),
        )
        self.assertEqual(
            clip_timing.repeat_count({"repeat_count": LIMITS["min_repeat_count"]}),
            LIMITS["min_repeat_count"],
        )
        self.assertEqual(
            clip_timing.repeat_count({"repeat_count": LIMITS["max_repeat_count"]}),
            LIMITS["max_repeat_count"],
        )

    def test_playback_rate_out_of_range_returns_identity(self):
        self.assertEqual(clip_timing.playback_rate({"playback_rate": 5}), 1.0)
        self.assertEqual(clip_timing.playback_rate({"playback_rate": 0.2}), 1.0)

    def test_repeat_count_out_of_range_returns_identity(self):
        self.assertEqual(clip_timing.repeat_count({"repeat_count": 0}), 1)
        self.assertEqual(clip_timing.repeat_count({"repeat_count": 21}), 1)


if __name__ == "__main__":
    unittest.main()
