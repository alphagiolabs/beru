"""Run isolation through processor execution and the NDJSON worker interface."""

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import ffmpeg_runner
import encoders
import processor
from batch_context import BatchContext


def make_job(folder, *, encode=True):
    source = folder / "in.mp4"
    source.write_bytes(b"video fixture")
    return {
        "id": 42,
        "input_path": str(source),
        "output_path": str(folder / "out.mkv"),
        "source_width": 64,
        "source_height": 64,
        "video_duration": 1,
        "pix_fmt": "yuv420p",
        "encode_profile": "balanced",
        "operations": [{"mode": "blur", "region": {"x": 8, "y": 8, "w": 32, "h": 32}}]
        if encode else [],
    }


class ProcessorContextTests(unittest.TestCase):
    def test_mixed_profiles_keep_the_preflight_encoder_for_hardware_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            job = make_job(folder)
            jobs = [
                {**job, "encode_profile": "uquality"},
                {**job, "id": 43, "encode_profile": "fast", "output_path": str(folder / "fast.mkv")},
            ]
            encoders_used = {}

            def run(cmd, **kwargs):
                encoders_used[Path(cmd[-1]).name] = cmd[cmd.index("-c:v") + 1]
                return True, None

            with patch.object(processor, "_run_ffmpeg", side_effect=run), patch.object(
                processor, "detect_hw_encoder", return_value="h264_nvenc"
            ), redirect_stdout(io.StringIO()):
                result = processor.process_jobs(jobs, "ffmpeg", hw_encoder="h264_nvenc")
            self.assertEqual(result["succeeded"], 2, result)
            self.assertEqual(encoders_used, {"out.mkv": "libx264", "fast.mkv": "h264_nvenc"})

    def test_cancelled_run_does_not_cancel_a_subsequent_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = make_job(Path(tmp))
            first = BatchContext(ffmpeg_path="ffmpeg")
            second = BatchContext(ffmpeg_path="ffmpeg")
            first.cancel_event.set()
            with patch.object(processor, "_run_ffmpeg", return_value=(True, None)), redirect_stdout(io.StringIO()):
                cancelled = processor.process_jobs([job], "ffmpeg", ctx=first)
                completed = processor.process_jobs([job], "ffmpeg", ctx=second)
            self.assertEqual(cancelled["cancelled"], 1)
            self.assertEqual(completed["succeeded"], 1)

    def test_running_remux_encode_and_software_fallback_are_cancelled(self):
        real_popen = subprocess.Popen
        for path in ("remux", "encode", "fallback", "retry"):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                job = make_job(folder, encode=path != "remux")
                ctx = BatchContext(ffmpeg_path="run-ffmpeg", cancel_event=threading.Event())
                gpu = "h264_nvenc" if path == "fallback" else None
                ctx.hw_encoder = gpu
                timers = []

                def launch(cmd, **kwargs):
                    if "h264_nvenc" in cmd:
                        code = "import sys; sys.stderr.write('nvenc: no capable devices found\\n'); sys.exit(1)"
                    else:
                        code = (
                            "import pathlib,time; "
                            f"pathlib.Path({job['output_path']!r}).write_bytes(b'partial'); "
                        )
                        code += (
                            "import sys; sys.stderr.write('temporary failure\\n'); sys.exit(1)"
                            if path == "retry" else "time.sleep(2)"
                        )
                        timer = threading.Timer(0.25, ctx.cancel_event.set)
                        timer.start()
                        timers.append(timer)
                    return real_popen([sys.executable, "-u", "-c", code], **kwargs)

                started = time.monotonic()
                with patch.object(ffmpeg_runner.subprocess, "Popen", side_effect=launch), patch.object(
                    processor, "detect_hw_encoder", return_value=gpu
                ), redirect_stdout(io.StringIO()):
                    result = processor.process_jobs([job], ctx.ffmpeg_path, max_workers=1, ctx=ctx)
                for timer in timers:
                    timer.join()
                ctx.cancel_event.clear()
                self.assertEqual(result["cancelled"], 1, result)
                self.assertLess(time.monotonic() - started, 1.5)
                self.assertFalse(Path(job["output_path"]).exists())

    def test_cancellation_stops_a_job_waiting_for_a_software_slot(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            job = make_job(folder)
            jobs = [job, {**job, "id": 43, "output_path": str(folder / "other.mkv")}]
            ctx = BatchContext(
                ffmpeg_path="ffmpeg", hw_encoder="h264_nvenc",
                env={"BERU_WORKERS": "1", "BERU_RETRY_FAILED": "0"},
            )
            second_gpu_failed = threading.Event()
            lock = threading.Lock()
            calls = {"gpu": 0, "software": 0}

            def run(cmd, **kwargs):
                if "h264_nvenc" in cmd:
                    with lock:
                        calls["gpu"] += 1
                        if calls["gpu"] == 2:
                            second_gpu_failed.set()
                    return False, "nvenc: no capable devices found"
                with lock:
                    calls["software"] += 1
                self.assertTrue(second_gpu_failed.wait(timeout=3))
                ctx.cancel_event.set()
                return False, "Cancelled"

            with patch.object(processor, "_run_ffmpeg", side_effect=run), patch.object(
                processor, "_get_available_ram_mb", return_value=32_000
            ), redirect_stdout(io.StringIO()):
                result = processor.process_jobs(jobs, "ffmpeg", max_workers=2, ctx=ctx)
            self.assertEqual(result["cancelled"], 2, result)
            self.assertEqual(calls, {"gpu": 2, "software": 1})

    def test_same_job_id_reports_initial_progress_in_each_run(self):
        stdout = io.StringIO()
        code = "import sys; sys.stderr.write('time=00:00:00.01 speed=1.0x\\n')"
        with redirect_stdout(stdout):
            for _ in range(2):
                ctx = BatchContext(ffmpeg_path=sys.executable)
                result = processor._run_ffmpeg_stream(
                    [sys.executable, "-u", "-c", code], 3, 42, 1, ctx=ctx
                )
                self.assertEqual(result, (True, None))
        events = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual([event["percent"] for event in events], [1, 100, 1, 100])

    def test_worker_request_options_do_not_replace_process_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            job = make_job(folder)
            jobs = [job, {**job, "id": 43, "output_path": str(folder / "other.mkv")}]
            manifest = folder / "jobs.json"
            manifest.write_text(json.dumps(jobs), encoding="utf-8")
            requests = [
                {"id": 1, "jobs_file": str(manifest), "env": {"BERU_WORKERS": "2"}},
                {"id": 2, "jobs_file": str(manifest), "env": {}},
            ]
            stdin = SimpleNamespace(buffer=io.BytesIO(
                ("\n".join(json.dumps(request) for request in requests) + "\n").encode()
            ))
            commands = []

            def run(cmd, *args, **kwargs):
                commands.append(cmd)
                return True, None

            stdout = io.StringIO()
            with patch.dict(os.environ, {"BERU_WORKERS": "1"}), patch.object(
                processor.sys, "stdin", stdin
            ), patch.object(processor, "_init_ffmpeg_globals", return_value=True), patch.object(
                processor, "detect_hw_encoder", return_value=None
            ) as detect, patch.object(processor, "_run_ffmpeg", side_effect=run), redirect_stdout(stdout):
                processor.job_worker_main()
                self.assertEqual(os.environ.get("BERU_WORKERS"), "1")
            events = [json.loads(line) for line in stdout.getvalue().splitlines()]
            summaries = [event for event in events if event["type"] == "summary"]
            self.assertEqual([summary["workers"] for summary in summaries], [2, 1])
            self.assertEqual([summary["succeeded"] for summary in summaries], [2, 2])
            self.assertEqual(detect.call_count, 2)
            self.assertTrue(all(cmd[cmd.index("-c:v") + 1] == "libx264" for cmd in commands))

    def test_worker_cancel_sentinel_belongs_to_its_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            job = make_job(folder)
            cancelled_file = folder / "cancelled.json"
            next_file = folder / "next.json"
            for manifest in (cancelled_file, next_file):
                manifest.write_text(json.dumps([job]), encoding="utf-8")
            cancelled_file.with_suffix(".cancel").touch()
            requests = [
                {"id": 1, "jobs_file": str(cancelled_file)},
                {"id": 2, "jobs_file": str(next_file)},
            ]
            stdin = SimpleNamespace(buffer=io.BytesIO(
                ("\n".join(json.dumps(request) for request in requests) + "\n").encode()
            ))
            stdout = io.StringIO()
            with patch.object(processor.sys, "stdin", stdin), patch.object(
                processor, "_init_ffmpeg_globals", return_value=True
            ), patch.object(processor, "detect_hw_encoder", return_value=None), patch.object(
                processor, "_run_ffmpeg", return_value=(True, None)
            ), redirect_stdout(stdout):
                processor.job_worker_main()
            events = [json.loads(line) for line in stdout.getvalue().splitlines()]
            summaries = [event for event in events if event["type"] == "summary"]
            self.assertEqual([event["cancelled"] for event in summaries], [1, 0])
            self.assertEqual([event["succeeded"] for event in summaries], [0, 1])
            self.assertEqual([event for event in events if event["type"] == "run_end"], [
                {"type": "run_end", "id": 1, "ok": True},
                {"type": "run_end", "id": 2, "ok": True},
            ])

    def test_runs_use_their_own_probes_and_drawtext_capabilities(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            job = make_job(folder)
            job.pop("source_width")
            job.pop("source_height")
            job.pop("video_duration")
            job["operations"] = [{
                "mode": "text", "text": "Run tools", "letter_spacing": 3,
                "region": {"x": 0, "y": 0, "w": 64, "h": 64},
            }]
            commands, probes = [], []
            metadata = json.dumps({
                "streams": [{"codec_type": "video", "width": 64, "height": 64}],
                "format": {"duration": "1"},
            })
            binaries = [folder / name for name in ("probe-a.exe", "probe-b.exe")]
            for binary in binaries:
                binary.write_bytes(b"probe fixture")

            def probe(cmd, **kwargs):
                probes.append(cmd[0])
                text = " spacing <int>" if cmd[0] == "ffmpeg-a" else ""
                return SimpleNamespace(
                    returncode=0, stdout=metadata if cmd[0] in map(str, binaries) else text,
                    stderr="",
                )

            def run(cmd, **kwargs):
                commands.append(cmd)
                return True, None

            with patch.object(processor, "_run_ffmpeg", side_effect=run), patch.object(
                processor.media_probe.subprocess, "run", side_effect=probe
            ), redirect_stdout(io.StringIO()):
                for name, binary in zip(("ffmpeg-a", "ffmpeg-b", "ffmpeg-a"), (binaries[0], binaries[1], binaries[0])):
                    ctx = BatchContext(ffmpeg_path=name, ffprobe_path=str(binary))
                    result = processor.process_jobs([job], "other-ffmpeg", ctx=ctx)
                    self.assertEqual(result["succeeded"], 1, result)
            self.assertEqual([cmd[0] for cmd in commands], ["ffmpeg-a", "ffmpeg-b", "ffmpeg-a"])
            self.assertEqual([":spacing=3" in cmd[cmd.index("-filter_complex") + 1] for cmd in commands], [True, False, True])
            self.assertTrue(all(str(binary) in probes for binary in binaries))
            self.assertIn("ffmpeg-a", probes)
            self.assertIn("ffmpeg-b", probes)

    def test_failed_encoder_listing_is_not_cached(self):
        encoders._HW_ENCODER_CACHE = None
        encoders._HW_ENCODER_CACHE_FOR = None
        calls = []

        def run(cmd, **kwargs):
            calls.append(cmd)
            if len(calls) == 1:
                raise OSError("spawn failed")
            return SimpleNamespace(stdout="h264_nvenc", stderr="")

        with patch.object(encoders.subprocess, "run", side_effect=run):
            self.assertIsNone(encoders.detect_hw_encoder("flaky-ffmpeg"))
            self.assertEqual(encoders.detect_hw_encoder("flaky-ffmpeg"), "h264_nvenc")
        self.assertEqual(len(calls), 2)

    def test_hardware_capabilities_are_not_reused_for_another_binary(self):
        with patch.object(encoders.subprocess, "run", side_effect=[
            SimpleNamespace(stdout="h264_nvenc", stderr=""),
            SimpleNamespace(stdout="", stderr=""),
        ]):
            self.assertEqual(encoders.detect_hw_encoder("gpu-ffmpeg"), "h264_nvenc")
            self.assertIsNone(encoders.detect_hw_encoder("cpu-ffmpeg"))
if __name__ == "__main__":
    unittest.main()
