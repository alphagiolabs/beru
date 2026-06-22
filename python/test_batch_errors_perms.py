"""Regression: FFmpeg stderr containing "operation not permitted" (POSIX EPERM)
was incorrectly classified as a hardware encoder failure. The user got a
message about GPU drivers when the real problem was file/folder permissions.

The fix: remove "operation not permitted" from is_hardware_encode_error's
markers, and add it to the permission-denied branch of format_processing_error.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from batch_errors import is_hardware_encode_error, format_processing_error  # noqa: E402


def test_operation_not_permitted_is_not_hardware():
    stderr = "av_interleaved_write_frame(): Operation not permitted"
    assert not is_hardware_encode_error(stderr), (
        f"'operation not permitted' must NOT be classified as hardware error, got True. "
        f"stderr={stderr!r}"
    )


def test_operation_not_permitted_yields_permissions_message():
    stderr = "av_interleaved_write_frame(): Operation not permitted"
    msg = format_processing_error(stderr)
    assert "permisos" in msg.lower(), (
        f"Expected permissions message for 'operation not permitted', got: {msg!r}"
    )
    # And it must NOT mention hardware/GPU/drivers
    assert "hardware" not in msg.lower(), (
        f"Permissions error must not mention hardware, got: {msg!r}"
    )
    assert "drivers" not in msg.lower()


def test_real_hardware_errors_still_detected():
    # Ensure removing "operation not permitted" didn't break real HW detection
    assert is_hardware_encode_error("h264_nvenc: encoder init failed")
    assert is_hardware_encode_error("Cannot load nvcuda.dll")
    assert is_hardware_encode_error("cuda error 999")
    msg = format_processing_error("h264_nvenc: encoder init failed")
    assert "hardware" in msg.lower()


def test_permission_denied_still_works():
    msg = format_processing_error("Permission denied")
    assert "permisos" in msg.lower()


if __name__ == "__main__":
    test_operation_not_permitted_is_not_hardware()
    test_operation_not_permitted_yields_permissions_message()
    test_real_hardware_errors_still_detected()
    test_permission_denied_still_works()
    print("OK: 'operation not permitted' classified as permissions, not hardware")
