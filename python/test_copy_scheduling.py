"""Stream-copy jobs run on a separate bounded I/O pool, and eligible inputs
take a native byte-copy path that skips the ffmpeg remux + faststart rewrite.
"""

import os
import tempfile
import threading
import time
from pathlib import Path

import processor


def _box(box_type, payload):
    return (8 + len(payload)).to_bytes(4, "big") + box_type + payload


_FTYP = _box(b"ftyp", b"isom\x00\x00\x02\x00isom")
MOOV_FIRST = _FTYP + _box(b"free", b"") + _box(b"moov", b"\x00" * 16) + _box(b"mdat", b"x" * 64)
MOOV_LAST = _FTYP + _box(b"mdat", b"x" * 64) + _box(b"moov", b"\x00" * 16)


def _make_job(folder, idx, **overrides):
    src = folder / f"in{idx}.mp4"
    if not src.exists():
        src.write_bytes(b"not a real video")
    job = {
        "id": idx,
        "input_path": str(src),
        "output_path": str(folder / f"out{idx}.mp4"),
        "source_width": 64,
        "source_height": 64,
        "video_duration": 3,
        "frame_rate": 10,
        "pix_fmt": "yuv420p",
        "audio_codec": "aac",
        "encode_profile": "uquality",
    }
    job.update(overrides)
    return job


class _Stub:
    """Save/replace/restore processor module attributes."""

    def __init__(self, **attrs):
        self._attrs = attrs
        self._orig = {}

    def __enter__(self):
        for name, value in self._attrs.items():
            self._orig[name] = getattr(processor, name)
            setattr(processor, name, value)
        return self

    def __exit__(self, *exc):
        for name, value in self._orig.items():
            setattr(processor, name, value)


def test_copy_path_classification():
    assert processor._job_takes_copy_path({"operations": []})
    assert processor._job_takes_copy_path({"trim_start": 0, "trim_end": None})
    assert not processor._job_takes_copy_path({"operations": [{"mode": "blur"}]})
    assert not processor._job_takes_copy_path({"watermark": {"enabled": True}})
    assert not processor._job_takes_copy_path({"trim_start": 1})
    assert not processor._job_takes_copy_path({"trim_end": 5})
    assert not processor._job_takes_copy_path({"trim_start": "abc"})
    assert not processor._job_takes_copy_path("not a dict")


def test_resolve_copy_workers():
    prev = os.environ.get("BERU_COPY_WORKERS")
    try:
        os.environ.pop("BERU_COPY_WORKERS", None)
        assert processor.resolve_copy_workers(0) == 0
        assert processor.resolve_copy_workers(1) == 1
        assert processor.resolve_copy_workers(9) == 2
        os.environ["BERU_COPY_WORKERS"] = "4"
        assert processor.resolve_copy_workers(9) == 4
        assert processor.resolve_copy_workers(3) == 3
        os.environ["BERU_COPY_WORKERS"] = "999"
        assert processor.resolve_copy_workers(99) == processor.MAX_WORKERS_CAP
    finally:
        if prev is None:
            os.environ.pop("BERU_COPY_WORKERS", None)
        else:
            os.environ["BERU_COPY_WORKERS"] = prev


def test_split_pools_overlap():
    """Copies ahead of encodes must not occupy encode slots: with the old
    shared pool the leading copies would fill every worker and the encodes
    would wait, so `encodes_started` would never fire."""
    folder = Path(tempfile.mkdtemp(prefix="beru_pools_"))
    blur = {"mode": "blur", "region": {"x": 8, "y": 8, "w": 32, "h": 32}}
    jobs = [_make_job(folder, i) for i in range(4)]
    jobs += [_make_job(folder, 10 + i, operations=[blur]) for i in range(2)]

    encodes_started = threading.Event()
    lock = threading.Lock()
    active = {"encode": 0, "copy": 0}
    peaks = {"encode": 0, "copy": 0}

    def fake_run(cmd, timeout_sec=600, job_id=None, duration_sec=0.0, *, ctx=None):
        cls = "encode" if "-filter_complex" in cmd else "copy"
        with lock:
            active[cls] += 1
            peaks[cls] = max(peaks[cls], active[cls])
        try:
            if cls == "encode":
                encodes_started.set()
                time.sleep(0.05)
            else:
                assert encodes_started.wait(timeout=10)
        finally:
            with lock:
                active[cls] -= 1
        return True, None

    processor._cancel_event.clear()
    with _Stub(_run_ffmpeg=fake_run, _native_copy_eligible=lambda *a, **k: False):
        result = processor.process_jobs(jobs, "ffmpeg", max_workers=2, hw_encoder=None)

    assert result["succeeded"] == 6, result
    assert encodes_started.is_set()
    assert peaks["encode"] <= 2, peaks
    assert 1 <= peaks["copy"] <= 2, peaks


def test_native_copy_eligibility():
    folder = Path(tempfile.mkdtemp(prefix="beru_natelig_"))
    fast = folder / "fast.mp4"
    fast.write_bytes(MOOV_FIRST)
    slow = folder / "slow.mp4"
    slow.write_bytes(MOOV_LAST)
    mkv = folder / "in.mkv"
    mkv.write_bytes(b"fake mkv")
    out_mp4 = folder / "out.mp4"
    out_mkv = folder / "out.mkv"

    def eligible(src, dst, streams):
        with _Stub(_probe_stream_types=lambda p, s=streams: s):
            return processor._native_copy_eligible(str(src), str(dst))

    va = [("video", "h264"), ("audio", "aac")]
    assert eligible(fast, out_mp4, va)
    assert not eligible(slow, out_mp4, va)
    assert not eligible(fast, out_mkv, va)
    assert not eligible(fast, out_mp4, va + [("audio", "aac")])
    assert not eligible(fast, out_mp4, va + [("subtitle", "mov_text")])
    assert not eligible(mkv, out_mkv, [("video", "h264"), ("audio", "pcm_s16le")])
    assert eligible(mkv, out_mkv, va)
    assert not eligible(mkv, out_mkv, [])
    assert not eligible(mkv, out_mkv, None)


def test_native_copy_end_to_end():
    folder = Path(tempfile.mkdtemp(prefix="beru_native_"))
    src = folder / "in.mp4"
    src.write_bytes(MOOV_FIRST)
    out = folder / "out.mp4"
    job = {
        "id": 0,
        "input_path": str(src),
        "output_path": str(out),
        "audio_codec": "aac",
        "operations": [],
    }

    def forbidden(*a, **k):
        raise AssertionError("eligible copy must not spawn ffmpeg")

    processor._cancel_event.clear()
    with _Stub(
        _probe_stream_types=lambda p: [("video", "h264"), ("audio", "aac")],
        _run_ffmpeg=forbidden,
    ):
        result = processor._process_one(0, job, "ffmpeg", hw_encoder=None)

    assert result["status"] == "succeeded", result
    assert out.read_bytes() == MOOV_FIRST


def test_native_copy_falls_back_to_remux():
    folder = Path(tempfile.mkdtemp(prefix="beru_remux_"))
    src = folder / "slow.mp4"
    src.write_bytes(MOOV_LAST)
    job = _make_job(folder, 0)
    job["input_path"] = str(src)

    calls = []

    def fake_run(cmd, timeout_sec=600, job_id=None, duration_sec=0.0, *, ctx=None):
        calls.append(cmd)
        return True, None

    processor._cancel_event.clear()
    with _Stub(
        _run_ffmpeg=fake_run,
        _probe_stream_types=lambda p: [("video", "h264"), ("audio", "aac")],
    ):
        result = processor._process_one(0, job, "ffmpeg", hw_encoder=None)

    assert result["status"] == "succeeded", result
    assert calls, "expected remux fallback"
    cmd = calls[0]
    assert "-c" in cmd and "copy" in cmd
    assert "+faststart" in cmd


def test_native_copy_cancelled_midway():
    folder = Path(tempfile.mkdtemp(prefix="beru_cancel_"))
    src = folder / "in.mp4"
    src.write_bytes(MOOV_FIRST)
    out = folder / "out.mp4"
    job = {
        "id": 0,
        "input_path": str(src),
        "output_path": str(out),
        "audio_codec": "aac",
        "operations": [],
    }

    def probe_then_cancel(path):
        processor._cancel_event.set()
        return [("video", "h264"), ("audio", "aac")]

    processor._cancel_event.clear()
    try:
        with _Stub(_probe_stream_types=probe_then_cancel):
            result = processor._process_one(0, job, "ffmpeg", hw_encoder=None)
    finally:
        processor._cancel_event.clear()

    assert result["status"] == "cancelled", result
    assert not out.exists()


def test_cancelled_remux_reports_cancelled():
    folder = Path(tempfile.mkdtemp(prefix="beru_remcancel_"))
    job = _make_job(folder, 0)
    src = folder / "in0.mkv"
    src.write_bytes(b"fake mkv")
    job["input_path"] = str(src)
    job["output_path"] = str(folder / "out0.mp4")

    processor._cancel_event.clear()
    with _Stub(
        _run_ffmpeg=lambda *a, **k: (False, "Cancelled"),
        _native_copy_eligible=lambda *a, **k: False,
    ):
        result = processor._process_one(0, job, "ffmpeg", hw_encoder=None)

    assert result["status"] == "cancelled", result


def main():
    test_copy_path_classification()
    test_resolve_copy_workers()
    test_split_pools_overlap()
    test_native_copy_eligibility()
    test_native_copy_end_to_end()
    test_native_copy_falls_back_to_remux()
    test_native_copy_cancelled_midway()
    test_cancelled_remux_reports_cancelled()
    print("ALL PASSED")


if __name__ == "__main__":
    main()
