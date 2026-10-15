#!/usr/bin/env python3

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from media_probe import find_ffmpeg, find_ffprobe

REPO = HERE.parent
VW, VH, DUR, FPS = 160, 90, 3.0, 25
LOGO = {"x": 40, "y": 20, "w": 30, "h": 20}


def _run(cmd, **kw):
    return subprocess.run([str(a) for a in cmd], capture_output=True, timeout=300, **kw)


def _fixture_dir():
    root = REPO / ".tmp" / "test-temporal-progress"
    shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _make_input(path, vf_tail="", output_args=()):
    vf = f"drawbox=x={LOGO['x']}:y={LOGO['y']}:w={LOGO['w']}:h={LOGO['h']}:color=red@1:t=fill"
    if vf_tail:
        vf += "," + vf_tail
    result = _run([
        find_ffmpeg(), "-y", "-v", "error", "-f", "lavfi",
        "-i", f"testsrc2=size={VW}x{VH}:rate={FPS}:duration={DUR}",
        "-vf", vf, *output_args,
        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-an", path,
    ], text=True)
    assert result.returncode == 0, result.stderr[-800:]


def _manifest(input_path, output_path):
    return {
        "type": "beru-job-manifest",
        "version": 1,
        "jobs": [{
            "id": 0,
            "input_path": str(input_path),
            "output_path": str(output_path),
            "width": VW,
            "height": VH,
            "source_width": VW,
            "source_height": VH,
            "operations": [{
                "mode": "delogo",
                "region": dict(LOGO),
                "delogo_method": "inpaint",
                "edge_feather": 4,
                "temporal_radius": 2,
                "blur_strength": 20,
            }],
            "video_duration": DUR,
            "video_codec": "h264",
            "pix_fmt": "yuv420p",
            "frame_rate": FPS,
            "encode_profile": "fast",
            "kind": "video",
            "trim_start": 0,
            "playback_rate": 1,
            "repeat_count": 1,
            "start": 0,
            "end": None,
            "rate": 1,
            "input_root": str(Path(input_path).parent),
            "asset_roots": [],
            "video_info_probed": True,
        }],
    }


def _run_processor(workdir, manifest):
    manifest_path = workdir / "jobs.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    logs = workdir / "logs"
    env = dict(os.environ)
    env.update({
        "BERU_FFMPEG": str(find_ffmpeg()),
        "BERU_FFPROBE": str(find_ffprobe(find_ffmpeg())),
        "BERU_LOG_DIR": str(logs),
        "BERU_TEMPORAL_BUDGET_S": "300",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUTF8": "1",
    })
    result = _run([sys.executable, str(HERE / "processor.py"), manifest_path],
                  cwd=str(REPO), env=env)
    events = []
    for line in result.stdout.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return result, events


def _summary(events):
    return next(e for e in events if e.get("type") == "summary")


def _patch_events(events):
    return [e for e in events if e.get("type") == "job_progress" and e.get("phase") == "patch"]


def _warnings(events):
    return [e for e in events if e.get("type") == "warning"]


def test_patch_phase_emits_job_progress():
    workdir = _fixture_dir()
    try:
        src = workdir / "cfr-in.mp4"
        _make_input(src)
        manifest = _manifest(src, workdir / "cfr-out.mp4")
        result, events = _run_processor(workdir, manifest)
        assert result.returncode == 0, result.stdout.decode(errors="replace")[-1500:] + \
            result.stderr.decode(errors="replace")[-1500:]

        assert _summary(events)["succeeded"] == 1, _summary(events)
        patch = _patch_events(events)
        assert patch, "no patch-phase job_progress was emitted"
        percents = [e["percent"] for e in patch]
        assert percents == sorted(percents), f"patch percent not monotonic: {percents}"
        assert max(percents) < 20, f"patch percent left its range: {percents}"
        encode_percents = [e["percent"] for e in events
                           if e.get("type") == "job_progress" and not e.get("phase")]
        assert encode_percents and min(encode_percents) >= 20, encode_percents
        assert max(e["percent"] for e in events
                   if e.get("type") == "job_progress") == 100.0
        output = Path(manifest["jobs"][0]["output_path"])
        assert output.exists() and output.stat().st_size > 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def test_variable_timing_keeps_patch():
    workdir = _fixture_dir()
    try:
        src = workdir / "vfr-in.mp4"
        _make_input(src, vf_tail="setpts=PTS+if(gt(N\\,5)\\,0.12/TB\\,0)")
        manifest = _manifest(src, workdir / "vfr-out.mp4")
        result, events = _run_processor(workdir, manifest)

        codes = sorted({e.get("code") for e in _warnings(events)})
        assert "patch_skipped_timing" not in codes, f"dropped frames skipped the patch: {codes}"
        assert _summary(events)["succeeded"] == 1, _summary(events)
        output = Path(manifest["jobs"][0]["output_path"])
        assert output.exists() and output.stat().st_size > 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def test_irregular_timing_warns_and_falls_back():
    workdir = _fixture_dir()
    try:
        src = workdir / "irregular-in.mkv"
        # Every other frame lands 0.1 frame after its predecessor.
        _make_input(
            src,
            vf_tail="settb=1/1000,setpts=(N-0.9*mod(N\\,2))*0.04/TB",
            output_args=("-fps_mode", "passthrough", "-enc_time_base", "1:1000"),
        )
        manifest = _manifest(src, workdir / "irregular-out.mp4")
        result, events = _run_processor(workdir, manifest)

        codes = sorted({e.get("code") for e in _warnings(events)})
        assert "patch_skipped_timing" in codes, f"expected patch-skipped warning; got {codes}"
        assert _summary(events)["succeeded"] == 1, _summary(events)
        patch = _patch_events(events)
        assert patch, "patch phase emitted no frames before bailing"
        output = Path(manifest["jobs"][0]["output_path"])
        assert output.exists() and output.stat().st_size > 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def test_terminating_thread_counts_as_hardware_error():
    from batch_errors import is_hardware_encode_error  # noqa: E402

    text = "FFmpeg exited with code 4294967274: [out#0/mp4] Terminating thread with return code -22"
    assert is_hardware_encode_error(text), "terminating-thread EINVAL should retry in software"
    assert not is_hardware_encode_error("Invalid argument"), "plain EINVAL must not force software"


def main():
    tests = [
        test_patch_phase_emits_job_progress,
        test_variable_timing_keeps_patch,
        test_irregular_timing_warns_and_falls_back,
        test_terminating_thread_counts_as_hardware_error,
    ]
    failed = 0
    for test in tests:
        try:
            test()
        except AssertionError as exc:
            failed += 1
            print(f"[FAIL] {test.__name__}: {exc}")
        else:
            print(f"[ok] {test.__name__}")
    print(f"temporal progress: {len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
