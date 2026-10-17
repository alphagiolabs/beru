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
import media_probe
import capacity
import processor
import batch_context
from batch_context import BatchContext, BatchScheduling, check_cancelled
from batch_errors import ProcessingCancelled


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
    def test_cancellation_is_identified_by_type_instead_of_error_text(self):
        job = {"id": -2, "kind": "stabilization", "output_path": "unused.mp4"}
        for error, expected in ((RuntimeError("Cancelled"), "failed"), (ProcessingCancelled(), "cancelled")):
            with self.subTest(expected=expected), redirect_stdout(io.StringIO()) as stdout, patch.object(
                processor, "process_stabilization", side_effect=error
            ):
                ctx = BatchContext(ffmpeg_path="ffmpeg")
                result = processor._process_one(0, job, ctx.ffmpeg_path, ctx=ctx)
                self.assertEqual(result["status"], expected, result)
                events = [json.loads(line) for line in stdout.getvalue().splitlines()]
                self.assertEqual([event["index"] for event in events if event["type"] == "cancelled"],
                                 [-2] if expected == "cancelled" else [])
                if expected == "failed":
                    self.assertIn("Cancelled", result.get("raw_error", result["error"]))

    def test_cancel_sentinel_requires_its_run_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "jobs.json"
            manifest.with_suffix(".cancel").touch()
            ctx = BatchContext(ffmpeg_path="ffmpeg", jobs_file=str(manifest))
            self.assertFalse(check_cancelled())
            self.assertTrue(check_cancelled(ctx))
            self.assertTrue(ctx.cancel_event.is_set())

    def test_context_and_direct_tools_cannot_compete(self):
        ctx = BatchContext(ffmpeg_path="run-ffmpeg")
        with self.assertRaisesRegex(ValueError, "conflicts with ctx"):
            processor.process_jobs([], "other-ffmpeg", ctx=ctx)

    def test_completed_output_survives_a_late_cancellation(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = make_job(Path(tmp))
            ctx = BatchContext(ffmpeg_path="ffmpeg")

            def run(cmd, **kwargs):
                Path(cmd[-1]).write_bytes(b"complete")
                ctx.cancel_event.set()
                return True, None

            with patch.object(ffmpeg_runner, "_run_ffmpeg", side_effect=run), redirect_stdout(io.StringIO()):
                result = processor.process_jobs([job], ctx=ctx, max_workers=1)
            self.assertEqual(result["succeeded"], 1, result)
            self.assertEqual(Path(job["output_path"]).read_bytes(), b"complete")

    def test_batches_derive_scheduling_without_mutating_the_supplied_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = make_job(Path(tmp))
            ctx = BatchContext(ffmpeg_path="run-ffmpeg", scheduling=BatchScheduling(hw_encoder="h264_nvenc"))
            original = ctx.scheduling
            encoders_used = []

            def run(cmd, **kwargs):
                encoders_used.append((cmd[0], cmd[cmd.index("-c:v") + 1], kwargs["ctx"].scheduling.max_workers))
                return True, None

            with patch.object(ffmpeg_runner, "_run_ffmpeg", side_effect=run), redirect_stdout(io.StringIO()):
                for encoder, workers in (("h264_nvenc", 2), (None, 1)):
                    result = processor.process_jobs([job], ctx=ctx, hw_encoder=encoder, max_workers=workers)
                    self.assertEqual(result["succeeded"], 1, result)
                    self.assertIs(ctx.scheduling, original)
            self.assertEqual(encoders_used, [("run-ffmpeg", "h264_nvenc", 2), ("run-ffmpeg", "libx264", 1)])
            self.assertEqual((original.hw_encoder, original.max_workers, original.sw_fallback_admission),
                             ("h264_nvenc", 1, None))

    def test_composition_shares_hardware_failure_across_stages_and_retry_passes(self):
        info = {"width": 64, "height": 64, "duration": 1, "frame_rate": 30, "pix_fmt": "yuv420p"}
        for intermediate in (False, True):
            with self.subTest(intermediate=intermediate), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                clip = make_job(folder, encode=intermediate)
                job = {"id": -1, "kind": "composition", "clips": [clip],
                       "canvas": {"width": 64, "height": 64, "fit": "contain"},
                       "composition_fps": 30, "output_path": str(folder / "output.mp4")}
                ctx = BatchContext(ffmpeg_path="ffmpeg", jobs_file=str(folder / "jobs.json"),
                                   env={"BERU_RETRY_FAILED": "1"})
                encoders_used = []
                final_attempts = []

                def run(cmd, **kwargs):
                    encoder = cmd[cmd.index("-c:v") + 1]
                    encoders_used.append(encoder)
                    Path(cmd[-1]).write_bytes(b"partial")
                    if encoder == "h264_nvenc":
                        return False, "nvenc: no capable devices found"
                    if cmd[-1] == job["output_path"]:
                        final_attempts.append(kwargs["ctx"].scheduling.max_workers)
                        if len(final_attempts) == 1:
                            return False, "x264 [error]: out of memory"
                    return True, None

                with patch.object(media_probe, "ffprobe", return_value=info), patch.object(
                    ffmpeg_runner, "_run_ffmpeg", side_effect=run
                ), redirect_stdout(io.StringIO()) as stdout:
                    result = processor.process_jobs([job], ctx=ctx, max_workers=2, hw_encoder="h264_nvenc")
                self.assertEqual(result["succeeded"], 1, result)
                self.assertEqual(encoders_used[0], "h264_nvenc")
                self.assertTrue(all(encoder == "libx264" for encoder in encoders_used[1:]), encoders_used)
                self.assertEqual(final_attempts, [2, 1])
                events = [json.loads(line) for line in stdout.getvalue().splitlines()]
                self.assertEqual([(event["type"], event["index"]) for event in events
                                  if event["type"] in ("complete", "error", "cancelled")], [("complete", -1)])
                self.assertEqual(Path(job["output_path"]).read_bytes(), b"partial")
                self.assertFalse(list(folder.glob("beru-composition-*")))

    def test_composition_capacity_accounts_for_later_sources_and_output_canvas(self):
        small={"width":64,"height":64,"encode_profile":"fast"}
        large={"width":3840,"height":2160,"video_codec":"hevc","pix_fmt":"yuv420p10le","encode_profile":"fast"}
        for clips,canvas in (([small,large],{"width":64,"height":64}),
                             ([small,small],{"width":3840,"height":2160})):
            job={"kind":"composition","clips":clips,"canvas":canvas,"encode_profile":"fast"}
            with self.subTest(canvas=canvas), patch.object(capacity,"get_available_ram_mb",return_value=2000):
                workers=capacity._memory_cap_workers(None,0,4,True,"fast",jobs=[job])
                self.assertEqual(workers,1,"A composition must not schedule concurrent stages beyond its RAM budget")

    def test_render_failure_emits_only_the_parent_job_terminal(self):
        info = {"width": 64, "height": 64, "duration": 1, "frame_rate": 30, "pix_fmt": "yuv420p"}
        for kind, phase in (("video", "cycle"), ("video", "output"),
                            ("composition", "cycle"), ("composition", "edited"), ("composition", "output")):
            for cancelled in (False, True):
                with self.subTest(kind=kind, phase=phase, cancelled=cancelled), tempfile.TemporaryDirectory() as tmp:
                    folder = Path(tmp)
                    clip = {**make_job(folder), "repeat_count": 2}
                    job = clip if kind == "video" else {
                        **clip, "id": -1, "kind": kind, "clips": [clip, clip],
                        "canvas": {"width": 64, "height": 64, "fit": "contain"}, "composition_fps": 30,
                    }
                    ctx = BatchContext(ffmpeg_path="ffmpeg", jobs_file=str(folder / "jobs.json"),
                                       env={"BERU_RETRY_FAILED": "0"})
                    attempted = []

                    def run(cmd, **kwargs):
                        output = Path(cmd[-1])
                        attempted.append(output.name)
                        output.write_bytes(b"partial")
                        should_fail = output.name.startswith(phase) if phase != "output" else str(output) == job["output_path"]
                        if should_fail:
                            if cancelled:
                                ctx.cancel_event.set()
                            return False, "Cancelled" if cancelled else "fixture encoder failure"
                        return True, None

                    stdout = io.StringIO()
                    with patch.object(media_probe, "ffprobe", return_value=info), patch.object(ffmpeg_runner, "_run_ffmpeg", side_effect=run
                    ), redirect_stdout(stdout):
                        result = processor.process_jobs([job], ctx=ctx)
                    events = [json.loads(line) for line in stdout.getvalue().splitlines()]
                    terminals = [event for event in events if event["type"] in ("complete", "error", "cancelled")]
                    self.assertEqual([(event["type"], event["index"]) for event in terminals],
                                     [("cancelled" if cancelled else "error", job["id"])], events)
                    self.assertEqual(result["cancelled" if cancelled else "failed"], 1, result)
                    self.assertTrue(attempted, "The failure must occur during rendering")
                    self.assertFalse(Path(job["output_path"]).exists())
                    self.assertFalse(list(folder.glob("beru-loop-*")))
                    self.assertFalse(list(folder.glob("beru-composition-*")))

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

            with patch.object(ffmpeg_runner, "_run_ffmpeg", side_effect=run), patch.object(encoders, "detect_hw_encoder", return_value="h264_nvenc"
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
            with patch.object(ffmpeg_runner, "_run_ffmpeg", return_value=(True, None)), redirect_stdout(io.StringIO()):
                cancelled = processor.process_jobs([job], ctx=first)
                completed = processor.process_jobs([job], ctx=second)
            self.assertEqual(
                {key: cancelled[key] for key in ("total", "succeeded", "failed", "cancelled")},
                {"total": 1, "succeeded": 0, "failed": 0, "cancelled": 1},
            )
            self.assertEqual(
                {key: completed[key] for key in ("total", "succeeded", "failed", "cancelled")},
                {"total": 1, "succeeded": 1, "failed": 0, "cancelled": 0},
            )

    def test_running_remux_encode_and_software_fallback_are_cancelled(self):
        real_popen = subprocess.Popen
        for path in ("remux", "encode", "fallback", "retry"):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                job = make_job(folder, encode=path != "remux")
                gpu = "h264_nvenc" if path == "fallback" else None
                ctx = BatchContext(ffmpeg_path="run-ffmpeg", cancel_event=threading.Event(),
                                   scheduling=BatchScheduling(hw_encoder=gpu))
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
                with patch.object(ffmpeg_runner.subprocess, "Popen", side_effect=launch), patch.object(encoders, "detect_hw_encoder", return_value=gpu
                ), redirect_stdout(io.StringIO()):
                    result = processor.process_jobs([job], max_workers=1, ctx=ctx)
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
                ffmpeg_path="ffmpeg", scheduling=BatchScheduling(hw_encoder="h264_nvenc"),
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

            with patch.object(ffmpeg_runner, "_run_ffmpeg", side_effect=run), patch.object(
                processor, "get_available_ram_mb", return_value=32_000
            ), patch.object(batch_context, "get_available_ram_mb", return_value=32_000), patch.object(capacity, "get_available_ram_mb", return_value=32_000
            ), redirect_stdout(io.StringIO()):
                result = processor.process_jobs(jobs, max_workers=2, ctx=ctx)
            self.assertEqual(result["cancelled"], 2, result)
            self.assertEqual(calls, {"gpu": 2, "software": 1})

    def test_same_job_id_reports_initial_progress_in_each_run(self):
        stdout = io.StringIO()
        code = "import sys; sys.stderr.write('time=00:00:00.01 speed=1.0x\\n')"
        with redirect_stdout(stdout):
            for _ in range(2):
                ctx = BatchContext(ffmpeg_path=sys.executable)
                result = ffmpeg_runner._run_ffmpeg_stream(
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
            ), patch.object(processor, "_init_ffmpeg_globals", return_value=True), patch.object(encoders, "detect_hw_encoder", return_value=None
            ) as detect, patch.object(ffmpeg_runner, "_run_ffmpeg", side_effect=run), redirect_stdout(stdout):
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
            ), patch.object(encoders, "detect_hw_encoder", return_value=None), patch.object(ffmpeg_runner, "_run_ffmpeg", return_value=(True, None)
            ), redirect_stdout(stdout):
                processor.job_worker_main()
            events = [json.loads(line) for line in stdout.getvalue().splitlines()]
            summaries = [event for event in events if event["type"] == "summary"]
            self.assertEqual([event["cancelled"] for event in summaries], [1, 0])
            self.assertEqual([event["succeeded"] for event in summaries], [0, 1])
            self.assertEqual([event for event in events if event["type"] == "run_end"], [
            {"type": "run_end", "id": 1, "ok": False},
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

            with patch.object(ffmpeg_runner, "_run_ffmpeg", side_effect=run), patch.object(
                media_probe.subprocess, "run", side_effect=probe
            ), redirect_stdout(io.StringIO()):
                for name, binary in zip(("ffmpeg-a", "ffmpeg-b", "ffmpeg-a"), (binaries[0], binaries[1], binaries[0])):
                    ctx = BatchContext(ffmpeg_path=name, ffprobe_path=str(binary))
                    result = processor.process_jobs([job], ctx=ctx)
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
