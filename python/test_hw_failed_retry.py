"""A job whose pass1 already burned the GPU fallback must retry pass2 in software."""

import io
import json
import os
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import ffmpeg_runner
import processor


def _make_job(folder, idx):
    src = folder / f"in{idx}.mp4"
    if not src.exists():
        src.write_bytes(b"not a real video")
    return {
        "id": idx,
        "input_path": str(src),
        "output_path": str(folder / f"out{idx}.mp4"),
        "source_width": 64,
        "source_height": 64,
        "video_duration": 3,
        "frame_rate": 10,
        "pix_fmt": "yuv420p",
        "audio_codec": "aac",
        "encode_profile": "fast",
        "operations": [
            {"mode": "blur", "region": {"x": 8, "y": 8, "w": 32, "h": 32}}
        ],
    }


def _encoder_of(cmd):
    return cmd[cmd.index("-c:v") + 1]


def test_pass2_runs_software_directly_for_hw_failed_jobs():
    with tempfile.TemporaryDirectory(prefix="beru_hwfailed_p2_") as tmp:
        folder = Path(tmp)
        jobs = [_make_job(folder, i) for i in range(2)]
        sequences = {}

        def fake_run(cmd, timeout_sec=600, job_id=None, duration_sec=0.0, *, ctx=None):
            enc = _encoder_of(cmd)
            out = str(cmd[-1])
            seq = sequences.setdefault(out, [])
            seq.append(enc)
            if enc != "libx264":
                return False, "nvenc: no capable devices found"
            if len(seq) == 2:
                return False, "x264 [error]: out of memory"
            return True, None

        orig_run = processor._run_ffmpeg
        prev_retry = os.environ.get("BERU_RETRY_FAILED")
        os.environ["BERU_RETRY_FAILED"] = "1"
        processor._run_ffmpeg = fake_run
        try:
            result = processor.process_jobs(
                jobs, "ffmpeg", max_workers=2, hw_encoder="h264_nvenc"
            )
            assert result["succeeded"] == 2, result
            assert result["failed"] == 0, result
            for out, seq in sequences.items():
                assert seq == ["h264_nvenc", "libx264", "libx264"], (out, seq)
        finally:
            processor._run_ffmpeg = orig_run
            if prev_retry is None:
                os.environ.pop("BERU_RETRY_FAILED", None)
            else:
                os.environ["BERU_RETRY_FAILED"] = prev_retry


def _run_batch(jobs, fake_run, **kwargs):
    stdout = io.StringIO()
    with patch.dict(os.environ, {"BERU_RETRY_FAILED": "1"}), patch.object(
        processor, "_run_ffmpeg", fake_run
    ), redirect_stdout(stdout):
        result = processor.process_jobs(jobs, "ffmpeg", hw_encoder=None, **kwargs)
    events = [json.loads(line) for line in stdout.getvalue().splitlines() if line.startswith("{")]
    return result, events


def test_retried_job_reports_only_its_final_outcome():
    with tempfile.TemporaryDirectory(prefix="beru_retry_events_") as tmp:
        folder = Path(tmp)
        jobs = [_make_job(folder, i) for i in range(2)]
        calls = {}

        def fake_run(cmd, timeout_sec=600, job_id=None, duration_sec=0.0, *, ctx=None):
            calls[job_id] = calls.get(job_id, 0) + 1
            if job_id == 1 or calls[job_id] == 1:
                return False, "x264 [error]: out of memory"
            return True, None

        result, events = _run_batch(jobs, fake_run, max_workers=2)
        errors = [e["index"] for e in events if e["type"] == "error"]
        assert (result["succeeded"], result["failed"]) == (1, 1), result
        assert errors == [1], events
        assert calls == {0: 2, 1: 2}, calls


def test_timeout_is_not_retried():
    with tempfile.TemporaryDirectory(prefix="beru_timeout_") as tmp:
        jobs = [_make_job(Path(tmp), i) for i in range(3)]
        calls = []

        def fake_run(cmd, timeout_sec=600, job_id=None, duration_sec=0.0, *, ctx=None):
            calls.append(job_id)
            return False, "Timeout after 600s"

        result, events = _run_batch(jobs, fake_run, max_workers=3)
        assert result["failed"] == 3, result
        assert sorted(calls) == [0, 1, 2], calls
        assert sorted(e["index"] for e in events if e["type"] == "error") == [0, 1, 2]

    timeouts = []

    def fake_stream(cmd, timeout_sec, job_id=None, duration_sec=0.0, *, ctx=None):
        timeouts.append(timeout_sec)
        return False, "Timeout after 0s"

    with patch.object(ffmpeg_runner, "_run_ffmpeg_stream", fake_stream):
        ffmpeg_runner._run_ffmpeg(["ffmpeg"], timeout_sec=600, job_id=0, duration_sec=1800)
    assert timeouts == [1800 * ffmpeg_runner.TRACKED_TIMEOUT_DURATION_FACTOR], timeouts


def test_unexpected_job_exception_reports_its_error():
    with tempfile.TemporaryDirectory(prefix="beru_job_crash_") as tmp:
        jobs = [_make_job(Path(tmp), 0)]
        stdout = io.StringIO()
        with patch.object(
            processor, "_process_one", side_effect=RuntimeError("boom")
        ), redirect_stdout(stdout):
            result = processor.process_jobs(jobs, "ffmpeg", max_workers=1, hw_encoder=None)
        events = [json.loads(line) for line in stdout.getvalue().splitlines() if line.startswith("{")]
        assert result["failed"] == 1, result
        errors = [e for e in events if e["type"] == "error"]
        assert [e["index"] for e in errors] == [0], events
        assert "boom" in errors[0].get("raw_error", errors[0]["error"]), events


def main():
    test_pass2_runs_software_directly_for_hw_failed_jobs()
    test_retried_job_reports_only_its_final_outcome()
    test_timeout_is_not_retried()
    test_unexpected_job_exception_reports_its_error()
    print("ALL PASSED")


if __name__ == "__main__":
    main()
