"""Regression: _extract_error_line returned lines[-2] when no line contained
"error". This assumed a trailing newline (lines[-1] would be ""). Without a
trailing newline, lines[-1] is the useful line and lines[-2] is noise — the
user saw the wrong error message. The fix: return the last non-empty line.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from processor import _extract_error_line  # noqa: E402


def test_no_error_word_with_trailing_newline():
    # Trailing newline → lines[-1]="" → old code returned lines[-2] (correct by
    # accident). New code must still return the last non-empty line.
    stderr = "frame=  100 fps=30\nConversion failed!\n"
    result = _extract_error_line(stderr)
    assert result == "Conversion failed!", f"Expected 'Conversion failed!', got {result!r}"


def test_no_error_word_without_trailing_newline():
    # NO trailing newline → lines[-1] is the useful line. Old code returned
    # lines[-2] (noise). New code must return lines[-1].
    stderr = "frame=  100 fps=30\nConversion failed!"
    result = _extract_error_line(stderr)
    assert result == "Conversion failed!", f"Expected 'Conversion failed!', got {result!r}"


def test_no_error_word_single_line_no_newline():
    stderr = "Conversion failed!"
    result = _extract_error_line(stderr)
    assert result == "Conversion failed!"


def test_error_word_takes_precedence():
    stderr = "frame=100\nError: bad codec\nConversion failed!"
    result = _extract_error_line(stderr)
    assert "Error: bad codec" == result


def test_empty_stderr():
    assert _extract_error_line("") == ""


def test_only_whitespace():
    assert _extract_error_line("\n\n\n") == ""


if __name__ == "__main__":
    test_no_error_word_with_trailing_newline()
    test_no_error_word_without_trailing_newline()
    test_no_error_word_single_line_no_newline()
    test_error_word_takes_precedence()
    test_empty_stderr()
    test_only_whitespace()
    print("OK: _extract_error_line returns last non-empty line")
