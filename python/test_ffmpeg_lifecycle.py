"""Failure injection at the FFmpeg process and worker protocol boundaries."""

import io
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import ffmpeg_runner
import processor
import temporal_pipeline
from batch_context import BatchContext


class FFmpegLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.folder = Path(self.directory.name)
        self.source = self.folder / "in.mp4"
        self.source.write_bytes(b"source")
        self.output = self.folder / "out.mkv"
        self.children = []
        self.popen = subprocess.Popen

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
        self.directory.cleanup()

    def launch(self, code, **kwargs):
        child = self.popen([sys.executable, "-u", "-c", code], **kwargs)
        self.children.append(child)
        return child

    def run_script(self, code, *, timeout=3, progress=False):
        cmd = ["fake-ffmpeg", "-i", str(self.source), str(self.output)]
        ctx = BatchContext(ffmpeg_path="fake-ffmpeg")
        with patch.object(ffmpeg_runner.subprocess, "Popen", side_effect=lambda _, **kw: self.launch(code, **kw)):
            return ffmpeg_runner._run_ffmpeg_stream(cmd, timeout, 7 if progress else None, 1 if progress else 0, ctx=ctx)

    def test_silent_failure_keeps_exit_code_and_removes_partial_output(self):
        code = f"from pathlib import Path; import sys; Path({str(self.output)!r}).write_bytes(b'partial'); sys.exit(9)"
        with patch.object(ffmpeg_runner.subprocess, "Popen", side_effect=lambda _, **kw: self.launch(code, **kw)):
            ok, error = ffmpeg_runner._run_ffmpeg(["fake-ffmpeg", "-i", str(self.source), str(self.output)])
        self.assertFalse(ok)
        self.assertIn("9", error)
        self.assertFalse(self.output.exists())
        self.assertIsNotNone(self.children[-1].poll())

    def test_zero_exit_requires_a_nonempty_output(self):
        for code in ("pass", f"from pathlib import Path; Path({str(self.output)!r}).touch()"):
            with self.subTest(code=code):
                ok, error = self.run_script(code)
                self.assertFalse(ok)
                self.assertIn("output", error.lower())

    def test_stderr_without_newlines_is_bounded(self):
        buf = ffmpeg_runner.StderrBuffer()
        buf.append("X" * 2_000_000)
        self.assertLessEqual(len(buf.join()), ffmpeg_runner.MAX_STDERR_CHARS)
        ok, error = self.run_script("import sys; sys.stderr.write('X' * 2_000_000); sys.exit(5)")
        self.assertFalse(ok)
        self.assertIn("5", error)
        self.assertLess(len(error), 1000)

    def test_progress_reader_failure_cannot_turn_into_success_or_leave_a_child(self):
        code = "import sys,time; sys.stderr.write('time=00:00:00.50 speed=1x\\n'); sys.stderr.flush(); time.sleep(5)"
        with patch.object(ffmpeg_runner, "_emit_job_progress", side_effect=RuntimeError("progress pipe failed")):
            ok, error = self.run_script(code, timeout=1, progress=True)
        self.assertFalse(ok)
        self.assertIn("progress pipe failed", error)
        self.assertIsNotNone(self.children[-1].poll())

    def test_repeated_warnings_and_unchanged_timestamps_do_not_hide_a_stall(self):
        code = "import sys,time\nfor i in range(100):\n sys.stderr.write('warning: busy time=00:00:00.00 speed=0x\\n'); sys.stderr.flush(); time.sleep(.02)"
        with patch.object(ffmpeg_runner, "STALL_TIMEOUT_SEC", 0.25, create=True):
            ok, error = self.run_script(code, timeout=1, progress=True)
        self.assertFalse(ok)
        self.assertIn("stalled", error.lower())
        self.assertIsNotNone(self.children[-1].poll())

    def test_failed_job_does_not_stop_later_jobs(self):
        jobs = [{"id": i, "input_path": str(self.source), "output_path": str(self.folder / f"{i}.mkv"), "operations": []} for i in range(2)]
        def launch(cmd, **kwargs):
            code = f"from pathlib import Path; import sys; Path({cmd[-1]!r}).write_bytes(b'export'); sys.exit({9 if cmd[-1].endswith('0.mkv') else 0})"
            return self.launch(code, **kwargs)
        stdout = io.StringIO()
        with patch.object(processor, "_native_copy_eligible", return_value=False), patch.object(ffmpeg_runner.subprocess, "Popen", side_effect=launch), redirect_stdout(stdout):
            summary = processor.process_jobs(jobs, "fake-ffmpeg", max_workers=1, hw_encoder=None)
        self.assertEqual((summary["succeeded"], summary["failed"]), (1, 1))
        events = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual([e["index"] for e in events if e["type"] == "complete"], [1])
        self.assertIn("9", next(e["error"] for e in events if e["type"] == "error"))
        self.assertFalse(Path(jobs[0]["output_path"]).exists())
        self.assertTrue(Path(jobs[1]["output_path"]).exists())

    def test_worker_reports_failed_and_cancelled_batches_and_accepts_the_next_request(self):
        stdin = SimpleNamespace(buffer=io.BytesIO(b'\n'.join(json.dumps({"id": i, "jobs_file": "m.json", "env": {}}).encode() for i in range(3)) + b'\n'))
        results = [{"total": 1, "succeeded": s, "failed": f, "cancelled": c} for s, f, c in ((0, 1, 0), (0, 0, 1), (1, 0, 0))]
        stdout = io.StringIO()
        with patch.object(processor.sys, "stdin", stdin), patch.object(processor, "_init_ffmpeg_globals", return_value=True), patch.object(processor, "_load_jobs_manifest", return_value=[]), patch.object(processor, "process_jobs", side_effect=results), redirect_stdout(stdout):
            processor.job_worker_main()
        endings = [json.loads(line) for line in stdout.getvalue().splitlines() if json.loads(line)["type"] == "run_end"]
        self.assertEqual([e["ok"] for e in endings], [False, False, True])
        self.assertEqual([e["id"] for e in endings], [0, 1, 2])

    def test_cli_exit_code_reflects_the_batch_outcome(self):
        for failed, cancelled, expected in ((1, 0, 1), (0, 1, 130), (0, 0, 0)):
            with self.subTest(expected=expected), patch.object(processor.sys, "argv", ["processor.py", "m.json"]), patch.object(processor, "protect_process_tree"), patch.object(processor, "_init_ffmpeg_globals", return_value=True), patch.object(processor, "_load_jobs_manifest", return_value=[]), patch.object(processor, "process_jobs", return_value={"failed": failed, "cancelled": cancelled}), redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as exit_result:
                    processor.main()
                self.assertEqual(exit_result.exception.code, expected)

    def test_temporal_monitor_failure_unblocks_both_ffmpeg_processes(self):
        resolver = temporal_pipeline.TemporalPatchResolver(str(self.source), str(self.folder), "fake-ffmpeg", 25)
        finished = threading.Event()
        failures = []
        def render():
            try:
                resolver(0, {"region": {"x": 8, "y": 8, "w": 16, "h": 16}, "delogo_method": "inpaint"}, 64, 64, "", "[0:v]", [])
            except Exception as exc:
                failures.append(str(exc))
            finally:
                finished.set()
        scan = temporal_pipeline.os.scandir
        def failing_scan(directory):
            if directory == str(self.folder):
                raise OSError("disk budget unavailable")
            return scan(directory)
        with patch.object(temporal_pipeline.subprocess, "Popen", side_effect=lambda _, **kw: self.launch("import time; time.sleep(60)", **kw)), patch.object(temporal_pipeline.os, "scandir", side_effect=failing_scan):
            thread = threading.Thread(target=render, daemon=True)
            thread.start()
            try:
                self.assertTrue(finished.wait(2), "temporal FFmpeg hung after its monitor failed")
                self.assertIn("disk budget unavailable", failures[0])
                self.assertEqual(len(self.children), 2)
                self.assertTrue(all(child.poll() is not None for child in self.children))
            finally:
                for child in self.children:
                    if child.poll() is None:
                        child.kill()
                thread.join(timeout=5)

    def test_a_long_video_reports_activity_even_below_one_percent(self):
        code = f"import sys,time; from pathlib import Path\nfor i in range(3):\n sys.stderr.write(f'time=00:00:0{{i+1}}.00 speed=1x\\n'); sys.stderr.flush(); time.sleep(1.1)\nPath({str(self.output)!r}).write_bytes(b'output')"
        stdout = io.StringIO()
        with patch.object(ffmpeg_runner.subprocess, "Popen", side_effect=lambda _, **kw: self.launch(code, **kw)), redirect_stdout(stdout):
            ok, error = ffmpeg_runner._run_ffmpeg_stream(["fake-ffmpeg", "-i", str(self.source), str(self.output)], 5, 7, 36_000, ctx=BatchContext(ffmpeg_path="fake-ffmpeg"))
        self.assertTrue(ok, error)
        events = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertGreaterEqual(sum(event["percent"] < 1 for event in events), 2)
        self.assertEqual(events[-1]["percent"], 100)


if __name__ == "__main__":
    unittest.main()
