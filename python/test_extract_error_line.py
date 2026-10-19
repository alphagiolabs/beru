import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from ffmpeg_runner import _extract_error_line# noqa: E402


def test_last_line_without_error_keyword_is_returned():
    for stderr in (
        "frame=  100 fps=30\nConversion failed!\n",
        "frame=  100 fps=30\nConversion failed!",
        "Conversion failed!",
    ):
        assert _extract_error_line(stderr) == "Conversion failed!", repr(stderr)


def test_error_word_takes_precedence():
    stderr = "frame=100\nError: bad codec\nConversion failed!"
    result = _extract_error_line(stderr)
    assert "Error: bad codec" == result


def test_prefer_invalid_over_generic_error_while():
    stderr = (
        "Error while filtering: Invalid argument\n"
        "[Parsed_crop_0 @ 0x1] Invalid too big or non positive size for width '200' or height '100'\n"
    )
    result = _extract_error_line(stderr)
    assert "Invalid too big" in result


def test_prefer_no_such_file():
    stderr = "Error while opening encoder\nNo such file or directory\n"
    result = _extract_error_line(stderr)
    assert "No such file" in result


def test_blank_stderr_yields_empty_line():
    for stderr in ("", "\n\n\n"):
        assert _extract_error_line(stderr) == "", repr(stderr)


if __name__ == "__main__":
    test_last_line_without_error_keyword_is_returned()
    test_error_word_takes_precedence()
    test_prefer_invalid_over_generic_error_while()
    test_prefer_no_such_file()
    test_blank_stderr_yields_empty_line()
    print("OK: _extract_error_line returns last non-empty line")
