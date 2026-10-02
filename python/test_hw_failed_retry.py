"""A job whose pass1 already burned the GPU fallback must retry pass2 in software."""

import os
import tempfile
from pathlib import Path

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


def test_hw_failed_flag_marks_job_and_skips_gpu():
    folder = Path(tempfile.mkdtemp(prefix="beru_hwfailed_"))
    job = _make_job(folder, 0)
    calls = []

    def fake_run(cmd, timeout_sec=600, job_id=None, duration_sec=0.0, *, ctx=None):
        calls.append(_encoder_of(cmd))
        if _encoder_of(cmd) != "libx264":
            return False, "nvenc: no capable devices found"
        return True, None

    orig_run = processor._run_ffmpeg
    orig_admission = processor._SOFTWARE_FALLBACK_ADMISSION
    processor._run_ffmpeg = fake_run
    processor._SOFTWARE_FALLBACK_ADMISSION = None
    processor._cancel_event.clear()
    try:
        r1 = processor._process_one(0, job, "ffmpeg", hw_encoder="h264_nvenc")
        assert r1["status"] == "succeeded", r1
        assert job.get("_hw_failed") is True
        assert calls == ["h264_nvenc", "libx264"], calls

        calls.clear()
        r2 = processor._process_one(0, job, "ffmpeg", hw_encoder="h264_nvenc")
        assert r2["status"] == "succeeded", r2
        assert calls == ["libx264"], calls
    finally:
        processor._run_ffmpeg = orig_run
        processor._SOFTWARE_FALLBACK_ADMISSION = orig_admission


def test_pass2_runs_software_directly_for_hw_failed_jobs():
    folder = Path(tempfile.mkdtemp(prefix="beru_hwfailed_p2_"))
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


def main():
    test_hw_failed_flag_marks_job_and_skips_gpu()
    test_pass2_runs_software_directly_for_hw_failed_jobs()
    print("ALL PASSED")


if __name__ == "__main__":
    main()
