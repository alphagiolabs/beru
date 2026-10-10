#!/usr/bin/env python3
"""Job worker: NDJSON framing, per-request env, cached hw preflight."""
import io
import json
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import processor  # noqa: E402


def _stdin_with(*lines):
    data = b""
    for line in lines:
        raw = line if isinstance(line, bytes) else json.dumps(line).encode()
        data += raw + b"\n"
    return SimpleNamespace(buffer=io.BytesIO(data))


def _manifest(path, jobs):
    path.write_text(
        json.dumps(
            {
                "type": processor.JOB_MANIFEST_TYPE,
                "version": processor.JOB_MANIFEST_VERSION,
                "jobs": jobs,
            }
        ),
        encoding="utf-8",
    )
    return str(path)


def _job():
    return {
        "id": 0,
        "input_path": "in.mp4",
        "output_path": "out.mp4",
        "operations": [{"mode": "text", "text": "x", "font_size": 24}],
        "encode_profile": "balanced",
    }


def _run_worker(stdin, *, process_jobs=None, detect_hw=None):
    stdout = io.StringIO()
    if process_jobs is None:
        def process_jobs(jobs, ffmpeg_path, max_workers=None, *, hw_encoder=None, ctx=None):
            return {"total": 1, "succeeded": 1, "failed": 0, "cancelled": 0, "workers": 1}
    with patch.object(processor.sys, "stdin", stdin), patch.object(
        processor, "_init_ffmpeg_globals", return_value=True
    ), patch.object(
        processor, "process_jobs", side_effect=process_jobs
    ) as pj, patch.object(
        processor, "detect_hw_encoder", side_effect=detect_hw or (lambda *a, **k: "h264_fake")
    ) as det:
        with redirect_stdout(stdout):
            processor.job_worker_main()
    lines = [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]
    return lines, pj, det


def test_worker_emits_ready_summary_and_run_end():
    with tempfile.TemporaryDirectory() as tmp:
        manifest = _manifest(Path(tmp) / "m.json", [_job()])
        stdin = _stdin_with({"id": 1, "jobs_file": manifest, "env": {"BERU_WORKERS": "0"}})
        lines, pj, det = _run_worker(stdin)

    assert lines[0] == {"type": "ready", "ok": True}
    assert lines[-1] == {"type": "run_end", "id": 1, "ok": True}
    assert any(line.get("type") == "summary" for line in lines), lines
    pj.assert_called_once()
    det.assert_called_once()
    assert det.call_args.kwargs.get("force_test") is True


def test_worker_probes_hardware_once_across_requests():
    with tempfile.TemporaryDirectory() as tmp:
        manifest = _manifest(Path(tmp) / "m.json", [_job()])
        stdin = _stdin_with(
            {"id": 1, "jobs_file": manifest, "env": {}},
            {"id": 2, "jobs_file": manifest, "env": {}},
        )
        lines, pj, det = _run_worker(stdin)

    assert pj.call_count == 2
    assert det.call_count == 2
    force_flags = [call.kwargs.get("force_test") for call in det.call_args_list]
    assert force_flags == [True, False], force_flags
    assert [line for line in lines if line.get("type") == "run_end"] == [
        {"type": "run_end", "id": 1, "ok": True},
        {"type": "run_end", "id": 2, "ok": True},
    ]


def test_worker_reprobes_with_force_test_after_failed_probe():
    with tempfile.TemporaryDirectory() as tmp:
        manifest = _manifest(Path(tmp) / "m.json", [_job()])
        stdin = _stdin_with(
            {"id": 1, "jobs_file": manifest, "env": {}},
            {"id": 2, "jobs_file": manifest, "env": {}},
            {"id": 3, "jobs_file": manifest, "env": {}},
        )
        detections = iter([None, "h264_fake", "h264_fake"])
        lines, pj, det = _run_worker(
            stdin, detect_hw=lambda *a, **k: next(detections)
        )

    assert pj.call_count == 3
    force_flags = [call.kwargs.get("force_test") for call in det.call_args_list]
    assert force_flags == [True, True, False], force_flags
    hw_args = [call.kwargs.get("hw_encoder") for call in pj.call_args_list]
    assert hw_args == [None, "h264_fake", "h264_fake"], hw_args
    assert [line for line in lines if line.get("type") == "run_end"] == [
        {"type": "run_end", "id": 1, "ok": True},
        {"type": "run_end", "id": 2, "ok": True},
        {"type": "run_end", "id": 3, "ok": True},
    ]


def test_worker_reports_manifest_errors_without_crashing():
    with tempfile.TemporaryDirectory() as tmp:
        bad = Path(tmp) / "bad.json"
        bad.write_text('{"type": "other", "version": 1, "jobs": []}', encoding="utf-8")
        stdin = _stdin_with({"id": 7, "jobs_file": str(bad), "env": {}})
        lines, pj, _ = _run_worker(stdin)

    pj.assert_not_called()
    assert lines[-1]["type"] == "run_end" and lines[-1]["ok"] is False
    assert lines[-1]["id"] == 7
    assert any(line.get("type") == "error" for line in lines)


def test_worker_rejects_invalid_request_shape():
    stdin = _stdin_with({"id": "abc", "jobs_file": 123})
    lines, pj, _ = _run_worker(stdin)
    pj.assert_not_called()
    assert lines[-1] == {"type": "run_end", "id": "abc", "ok": False, "error": "Invalid job request"}


def test_worker_rejects_unparseable_request_line():
    stdin = _stdin_with(b"not json{")
    lines, pj, _ = _run_worker(stdin)
    pj.assert_not_called()
    assert lines[-1]["type"] == "run_end" and lines[-1]["ok"] is False
    assert lines[-1]["id"] is None


def test_worker_rejects_oversized_stdin_before_parsing():
    oversized = b"x" * (processor.JOB_WORKER_MAX_REQUEST_BYTES + 1)
    stdin = _stdin_with(oversized)
    lines, pj, _ = _run_worker(stdin)
    pj.assert_not_called()
    assert lines == [{"type": "ready", "ok": True}]


def test_main_dispatch_accepts_job_worker_flag():
    calls = []
    with patch.object(processor.sys, "argv", ["processor.py", "--job-worker"]), patch.object(
        processor, "job_worker_main", side_effect=lambda: calls.append("job")
    ), patch.object(processor, "preview_frame_worker_main"):
        processor.main()
    assert calls == ["job"]


if __name__ == "__main__":
    test_worker_emits_ready_summary_and_run_end()
    test_worker_probes_hardware_once_across_requests()
    test_worker_reprobes_with_force_test_after_failed_probe()
    test_worker_reports_manifest_errors_without_crashing()
    test_worker_rejects_invalid_request_shape()
    test_worker_rejects_unparseable_request_line()
    test_worker_rejects_oversized_stdin_before_parsing()
    test_main_dispatch_accepts_job_worker_flag()
    print("ALL PASSED")
