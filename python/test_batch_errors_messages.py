#!/usr/bin/env python3
"""Per-job FFmpeg errors must map to user-facing Spanish messages, not raw stderr."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from batch_errors import format_processing_error


def assert_message(stderr, *expected_markers):
    msg = format_processing_error(stderr)
    missing = [m for m in expected_markers if m not in msg.lower()]
    assert not missing, (
        f"stderr={stderr!r} -> message {msg!r} missing markers {missing}"
    )
    assert "error when evaluating" not in msg.lower()
    return msg


def test_filter_expression_errors_map_to_region_message():
    assert_message(
        "Filter parameter 'x' has an undefined or invalid value: Error when evaluating the expression",
        "región",
    )


def test_invalid_region_size_maps_to_size_message():
    assert_message(
        "[Parsed_crop_1 @ ...] Invalid too big or non positive size for dimension 'w' 0",
        "tamaño",
    )


def test_overlay_mismatch_maps_to_layers_message():
    assert_message(
        "[Parsed_overlay_2 @ ...] Overlay: Input link parameters do not match the corresponding output link parameters",
        "capas",
    )


def test_corrupt_input_maps_to_input_message():
    assert_message(
        "moov atom not found: /path/input.mp4",
        "dañado",
    )
    assert_message(
        "Invalid data found when processing input",
        "dañado",
    )


def test_codec_errors_map_to_codec_message():
    assert_message(
        "Error while opening encoder for output stream #0:0 - maybe incorrect parameters such as bit_rate, rate, width or height",
        "códec",
    )
    assert_message(
        "Incompatible pixel format 'yuv420p10le' for codec 'libx264'",
        "códec",
    )


def test_muxing_errors_map_to_container_message():
    assert_message(
        "Too many packets buffered for output stream 0:1",
        "empaquetar",
    )
    assert_message(
        "Unable to find a suitable output format",
        "empaquetar",
    )


def test_fontconfig_maps_to_font_message():
    assert_message(
        "fontconfig: Can't find a valid font file for family 'Nonesuch'",
        "fuente",
    )


def test_drawtext_forbidden_maps_to_text_message():
    assert_message(
        "Drawtext contains forbidden characters",
        "overlay",
    )


def test_unknown_errors_keep_raw_tail():
    raw = "SOME WEIRD ERROR WITHOUT MARKERS"
    assert format_processing_error(raw) == raw


def main():
    test_filter_expression_errors_map_to_region_message()
    test_invalid_region_size_maps_to_size_message()
    test_overlay_mismatch_maps_to_layers_message()
    test_corrupt_input_maps_to_input_message()
    test_codec_errors_map_to_codec_message()
    test_muxing_errors_map_to_container_message()
    test_fontconfig_maps_to_font_message()
    test_drawtext_forbidden_maps_to_text_message()
    test_unknown_errors_keep_raw_tail()
    print("ALL PASSED")


if __name__ == "__main__":
    main()