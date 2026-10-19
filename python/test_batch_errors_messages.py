#!/usr/bin/env python3
"""Per-job FFmpeg errors must map to user-facing Spanish messages, not raw stderr."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from batch_errors import format_processing_error


MAPPED_ERRORS = [
    ("Filter parameter 'x' has an undefined or invalid value: Error when evaluating the expression", "región"),
    ("[Parsed_crop_1 @ ...] Invalid too big or non positive size for dimension 'w' 0", "tamaño"),
    ("[Parsed_overlay_2 @ ...] Overlay: Input link parameters do not match the corresponding output link parameters", "capas"),
    ("moov atom not found: /path/input.mp4", "dañado"),
    ("Invalid data found when processing input", "dañado"),
    ("Error while opening encoder for output stream #0:0 - maybe incorrect parameters such as bit_rate, rate, width or height", "códec"),
    ("Incompatible pixel format 'yuv420p10le' for codec 'libx264'", "códec"),
    ("Too many packets buffered for output stream 0:1", "empaquetar"),
    ("Unable to find a suitable output format", "empaquetar"),
    ("fontconfig: Can't find a valid font file for family 'Nonesuch'", "fuente"),
    ("Drawtext contains forbidden characters", "overlay"),
]


def assert_message(stderr, *expected_markers):
    msg = format_processing_error(stderr)
    missing = [m for m in expected_markers if m not in msg.lower()]
    assert not missing, (
        f"stderr={stderr!r} -> message {msg!r} missing markers {missing}"
    )
    assert "error when evaluating" not in msg.lower()


def test_known_ffmpeg_errors_map_to_user_messages():
    for stderr, marker in MAPPED_ERRORS:
        assert_message(stderr, marker)


def test_unknown_errors_keep_raw_tail():
    raw = "SOME WEIRD ERROR WITHOUT MARKERS"
    assert format_processing_error(raw) == raw


def main():
    test_known_ffmpeg_errors_map_to_user_messages()
    test_unknown_errors_keep_raw_tail()
    print("ALL PASSED")


if __name__ == "__main__":
    main()
