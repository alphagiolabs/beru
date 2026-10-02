#!/usr/bin/env python3
import io
import ctypes
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import processor


class FakeProcess:
    def __init__(self, image):
        self.stdout = io.BytesIO(image)
        self.stderr = io.BytesIO(b"")
        self.returncode = 0
        self.killed = False

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9


def test_preview_downscales_after_full_resolution_filters():
    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / "source.mp4"
        video.write_bytes(b"fake")
        image = b"\xff\xd8" + b"a" * 64
        proc = FakeProcess(image)
        payload = {"input_path": str(video), "source_width": 8000, "source_height": 4000,
                   "video_duration": 1, "operations": []}
        with patch.object(processor.subprocess, "Popen", return_value=proc) as popen:
            result = processor.render_preview_frame(payload)
        assert result["ok"] is True, result
        assert result["width"] <= 1280 and result["height"] <= 1280
        cmd = popen.call_args.args[0]
        assert any("scale=" in arg and "1280" in arg for arg in cmd)
        assert "-vcodec" in cmd and cmd[cmd.index("-vcodec") + 1] == "mjpeg"


def test_preview_rejects_excessive_jpeg_before_base64():
    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / "source.mp4"
        video.write_bytes(b"fake")
        proc = FakeProcess(b"x" * (4 * 1024 * 1024))
        payload = {"input_path": str(video), "source_width": 640, "source_height": 480,
                   "video_duration": 1, "operations": []}
        with patch.object(processor.subprocess, "Popen", return_value=proc):
            result = processor.render_preview_frame(payload)
        assert result["ok"] is False
        assert "límite" in result["error"].lower(), result
        assert proc.killed


def test_preview_scales_after_operation_filter_graph():
    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / "source.mp4"
        video.write_bytes(b"fake")
        payload = {"input_path": str(video), "source_width": 1920, "source_height": 1080,
                   "video_duration": 1, "operations": [{"mode": "blur"}]}
        with patch.object(processor, "build_filter_complex", return_value=(
            "[0:v]null[tmp0]", "[tmp0]", []
        )), patch.object(processor.subprocess, "Popen", return_value=FakeProcess(b"x" * 128)) as popen:
            result = processor.render_preview_frame(payload)
        assert result["ok"] is True, result
        cmd = popen.call_args.args[0]
        assert cmd[cmd.index("-filter_complex") + 1].index("scale=") > len("[0:v]null[tmp0]")
        assert cmd[cmd.index("-map") + 1] == "[preview]"


def test_windows_commit_budget_caps_automatic_workers_but_not_override():
    def global_memory_status(pointer):
        pointer._obj.ullAvailPhys = 8 * 1024 * 1024 * 1024
        pointer._obj.ullAvailPageFile = 96 * 1024 * 1024
        return True

    kernel32 = SimpleNamespace(GlobalMemoryStatusEx=global_memory_status)
    with patch.object(ctypes, "windll", SimpleNamespace(kernel32=kernel32), create=True), \
         patch.dict(processor.os.environ, {"BERU_WORKERS": "0"}):
        assert processor._get_available_ram_mb() == 96
        assert processor.resolve_max_workers(None, 5) == 1
        with patch.dict(processor.os.environ, {"BERU_WORKERS": "4"}):
            assert processor.resolve_max_workers(None, 5) == 4


def test_worker_rejects_oversized_stdin_before_parsing():
    stdin = SimpleNamespace(buffer=io.BytesIO(b"x" * (1024 * 1024 + 1) + b"\n"))
    with patch.object(processor.sys, "stdin", stdin), \
         patch.object(processor, "_init_ffmpeg_globals", return_value=True), \
         patch.object(processor, "get_system_fonts"), \
         patch.object(processor, "render_preview_frame") as render, \
         redirect_stdout(io.StringIO()) as stdout:
        processor.preview_frame_worker_main()
    assert stdout.getvalue().count("\n") == 1
    render.assert_not_called()


if __name__ == "__main__":
    test_preview_downscales_after_full_resolution_filters()
    test_preview_rejects_excessive_jpeg_before_base64()
    test_preview_scales_after_operation_filter_graph()
    test_windows_commit_budget_caps_automatic_workers_but_not_override()
    test_worker_rejects_oversized_stdin_before_parsing()
    print("ALL PASSED")
