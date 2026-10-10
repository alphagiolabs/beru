"""Isolated Job experiments. Production modules are never edited."""

import cProfile
import ctypes
import io
import json
import os
from pathlib import Path
import pstats
import subprocess
import sys
import time
import inspect
import threading
from functools import lru_cache
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))
import processor
from batch_context import BatchContext

processor._init_ffmpeg_globals()
original_popen = subprocess.Popen
original_filter = processor.build_filter_complex
original_run = processor._run_ffmpeg
original_info = processor.job_video_info
original_copy = processor._native_stream_copy
local = threading.local()


def process_times(proc):
    values = [ctypes.c_ulonglong() for _ in range(4)]
    function = ctypes.windll.kernel32.GetProcessTimes
    function.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(ctypes.c_ulonglong)] * 4
    if not function(int(proc._handle), *(ctypes.byref(value) for value in values)):
        raise ctypes.WinError()
    class Memory(ctypes.Structure):
        _fields_ = [("size", ctypes.c_uint32), ("faults", ctypes.c_uint32)] + [
            (name, ctypes.c_size_t) for name in (
                "peak", "rss", "paged_peak", "paged", "non_peak", "non", "commit", "peak_commit", "private"
            )]
    memory = Memory()
    query = ctypes.windll.psapi.GetProcessMemoryInfo
    query.argtypes = [ctypes.c_void_p, ctypes.POINTER(Memory), ctypes.c_uint32]
    counters = {}
    if query(int(proc._handle), ctypes.byref(memory), ctypes.sizeof(memory)):
        counters = {"os_peak_rss_bytes": memory.peak, "os_peak_commit_bytes": memory.peak_commit}
    return {"exit_stamp": values[1].value / 10_000_000 - 11644473600,
            "cpu_seconds": (values[2].value + values[3].value) / 10_000_000, **counters}


def timed(name, function):
    def call(*args, **kwargs):
        start = time.perf_counter()
        try:
            return function(*args, **kwargs)
        finally:
            current = getattr(local, "active", None)
            if current is not None:
                current["phases"].append({"name": name, "seconds": time.perf_counter() - start})
    return call


def launch(args, *other, **kwargs):
    active = getattr(local, "active", None)
    args = list(args)
    if active and Path(str(args[0])).name.lower() == "ffmpeg.exe" and "-filter_complex" in args:
        if active.get("diagnostic") == "decode-only" and "pipe:1" not in args:
            args = [args[0], "-v", "error", "-i", active["input_path"], "-map", "0:v:0", "-an", "-f", "null", "-"]
        elif active.get("diagnostic") == "filters-only" and "pipe:1" not in args:
            args = args[:args.index("-c:v")] + ["-an", "-c:v", "wrapped_avframe", "-pix_fmt", active["pix_fmt"], "-f", "null", "-"]
        if active["variant"] in {"decode2", "decode4"} and "pipe:1" not in args:
            first_input = args.index("-i")
            args[first_input:first_input] = ["-threads", active["variant"][-1]]
    proc = original_popen(args, *other, **kwargs)
    if active:
        active["commands"].append({"pid": proc.pid, "argv": args, "start": time.time()})
        active["_children"].append(proc)
    return proc


processor.build_filter_complex = timed("filters_and_patch_preparation", original_filter)
processor._run_ffmpeg = timed("ffmpeg_final", original_run)
processor.job_video_info = timed("metadata", original_info)
processor._native_stream_copy = timed("native_copy", original_copy)
subprocess.Popen = launch


def configure(variant):
    import ffmpeg_runner
    ffmpeg_runner._native_stream_copy = original_copy
    processor._native_stream_copy = timed("native_copy", original_copy)
    if variant in {"allocating-copy", "pre-optimizations"}:
        namespace = dict(ffmpeg_runner.__dict__)
        source = inspect.getsource(original_copy)
        replacements = (
            ('            buffer = bytearray(min(8 * 1024 * 1024, max(1, total_bytes)))\n'
             '            view = memoryview(buffer)\n', ''),
            ('                count = fin.readinto(buffer)\n                if not count:',
             '                chunk = fin.read(8 * 1024 * 1024)\n                if not chunk:'),
            ('                fout.write(view[:count])\n                copied_bytes += count',
             '                fout.write(chunk)\n                copied_bytes += len(chunk)'),
        )
        for before, after in replacements:
            if before not in source:
                raise RuntimeError("Allocating-copy control no longer matches source")
            source = source.replace(before, after)
        exec(compile(source, "<allocating-copy-control>", "exec"), namespace)
        processor._native_stream_copy = timed("native_copy", namespace["_native_stream_copy"])
    if variant == "copy-buffer":
        namespace = dict(ffmpeg_runner.__dict__)
        source = inspect.getsource(original_copy)
        source = source.replace('            while True:\n',
                                '            buffer = bytearray(8 * 1024 * 1024)\n'
                                '            view = memoryview(buffer)\n'
                                '            while True:\n')
        before = """                chunk = fin.read(8 * 1024 * 1024)
                if not chunk:
                    return True, None
                fout.write(chunk)"""
        after = """                count = fin.readinto(buffer)
                if not count:
                    return True, None
                fout.write(view[:count])"""
        if before not in source:
            raise RuntimeError("Copy-buffer experiment no longer matches source")
        exec(compile(source.replace(before, after), "<copy-buffer-experiment>", "exec"), namespace)
        processor._native_stream_copy = timed("native_copy", namespace["_native_stream_copy"])
    if not hasattr(ffmpeg_runner, "_audit_original_stream"):
        ffmpeg_runner._audit_original_stream = ffmpeg_runner._run_ffmpeg_stream
    ffmpeg_runner._run_ffmpeg_stream = ffmpeg_runner._audit_original_stream
    if variant in {"poll-wait", "pre-optimizations"}:
        namespace = dict(ffmpeg_runner.__dict__)
        source = inspect.getsource(ffmpeg_runner._run_ffmpeg_stream)
        before = """            try:
                proc.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                pass"""
        if before not in source:
            raise RuntimeError("Poll-wait control no longer matches source")
        exec(compile(source.replace(before, "            time.sleep(0.2)"),
                     "<poll-wait-control>", "exec"), namespace)
        ffmpeg_runner._run_ffmpeg_stream = namespace["_run_ffmpeg_stream"]
    if variant == "exit-wait":
        namespace = dict(ffmpeg_runner.__dict__)
        source = inspect.getsource(ffmpeg_runner._run_ffmpeg_stream)
        before = "            time.sleep(0.2)"
        after = """            try:
                proc.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                pass"""
        if before not in source:
            raise RuntimeError("Exit-wait experiment no longer matches source")
        exec(compile(source.replace(before, after), "<exit-wait-experiment>", "exec"), namespace)
        ffmpeg_runner._run_ffmpeg_stream = namespace["_run_ffmpeg_stream"]
    if variant != "gray-buffer" and "temporal_motion" not in sys.modules:
        if variant != "motion-grid":
            return
    import temporal_motion
    if not hasattr(temporal_motion, "_audit_original_motion"):
        temporal_motion._audit_original_motion = temporal_motion._motion
    temporal_motion._motion = temporal_motion._audit_original_motion
    if variant == "motion-grid":
        namespace = dict(temporal_motion.__dict__)
        np = namespace["np"]

        @lru_cache(maxsize=4)
        def grid(height, width, box):
            x, y, w, h = box
            step = max(1, int(np.sqrt(width * height / 900)))
            yy, xx = np.mgrid[2 : height - 2 : step, 2 : width - 2 : step]
            outside = (xx < x - 2) | (xx >= x + w + 2) | (yy < y - 2) | (yy >= y + h + 2)
            return xx[outside], yy[outside]

        source = inspect.getsource(temporal_motion._motion)
        before = """    step = max(1, int(np.sqrt(width * height / 900)))
    yy, xx = np.mgrid[2 : height - 2 : step, 2 : width - 2 : step]
    outside = (xx < x - 2) | (xx >= x + w + 2) | (yy < y - 2) | (yy >= y + h + 2)
    xx = xx[outside]
    yy = yy[outside]"""
        if before not in source:
            raise RuntimeError("Motion-grid experiment no longer matches source")
        namespace["_audit_grid"] = grid
        exec(compile(source.replace(before, "    xx, yy = _audit_grid(height, width, tuple(box))"),
                     "<motion-grid-experiment>", "exec"), namespace)
        temporal_motion._motion = namespace["_motion"]
    if not hasattr(temporal_motion, "_audit_original_gray"):
        temporal_motion._audit_original_gray = temporal_motion._gray
    temporal_motion._gray = temporal_motion._audit_original_gray
    if variant == "gray-buffer":
        namespace = dict(temporal_motion.__dict__)
        source = inspect.getsource(temporal_motion._gray)
        before = """    values = frame.astype(np.float32)
    scale = 257.0 if frame.dtype == np.uint16 else 1.0
    gray = (
        values[..., 0] * 0.299 + values[..., 1] * 0.587 + values[..., 2] * 0.114
    ) / scale"""
        after = """    scale = 257.0 if frame.dtype == np.uint16 else 1.0
    gray = frame[..., 0].astype(np.float32)
    gray *= 0.299
    component = frame[..., 1].astype(np.float32)
    component *= 0.587
    gray += component
    component = frame[..., 2].astype(np.float32)
    component *= 0.114
    gray += component
    gray /= scale"""
        if before not in source:
            raise RuntimeError("Gray experiment no longer matches source")
        exec(compile(source.replace(before, after), "<gray-buffer-experiment>", "exec"), namespace)
        temporal_motion._gray = namespace["_gray"]


original_process_one = processor._process_one


def audit_one(idx, job, ffmpeg_path, *, ctx=None, hw_encoder=None):
    active = {"variant": request["variant"], "commands": [], "phases": [],
              "diagnostic": request.get("diagnostic"), "input_path": job["input_path"],
              "pix_fmt": job["pix_fmt"], "job": job, "_children": [],
              "started": time.time() * 1000}
    local.active = active
    started = time.perf_counter()
    cpu_started = time.thread_time()
    process_cpu_started = time.process_time()
    profile = cProfile.Profile() if request.get("profile") else None
    try:
        if profile:
            profile.enable()
        result = original_process_one(idx, job, ffmpeg_path, ctx=ctx, hw_encoder=hw_encoder)
        active["result"] = result
        return result
    except Exception as error:
        active["failure"] = str(error)
        raise
    finally:
        if profile:
            profile.disable()
        active.update(seconds=time.perf_counter() - started,
                      python_cpu_seconds=time.thread_time() - cpu_started,
                      python_cpu_scope="executing_thread",
                      python_process_cpu_seconds=(time.process_time() - process_cpu_started
                          if "jobs" not in request or request.get("serial") else None),
                      ended=time.time() * 1000,
                      estimated_ram_mb=processor._estimate_job_ram_mb(
                          job, ctx.hw_encoder, processor._job_requires_encode(job),
                          job.get("encode_profile", "balanced")))
        for command, child in zip(active["commands"], active.pop("_children")):
            if child.poll() is not None:
                command.update(process_times(child))
        active["processor_lifetime_peaks"] = {
            key: value for key, value in process_times(SimpleNamespace(_handle=-1)).items()
            if key.startswith("os_peak_")
        }
        active["children_cpu_seconds"] = sum(command.get("cpu_seconds", 0)
                                             for command in active["commands"])
        final = [command for command in active["commands"] if command["argv"][-1] == job["output_path"]
                 and "exit_stamp" in command]
        if final:
            active["post_exit_ms"] = (time.time() - final[-1]["exit_stamp"]) * 1000
        if profile:
            profile.dump_stats(request["profile"])
            output = io.StringIO()
            pstats.Stats(profile, stream=output).sort_stats("cumulative").print_stats(35)
            active["profile_top"] = output.getvalue()
        with result_lock:
            measured_jobs.append(active)
        local.active = None


processor._process_one = audit_one
print(json.dumps({"type": "audit_ready", "python": sys.version}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    measured_jobs = []
    result_lock = threading.Lock()
    configure(request["variant"])
    context = BatchContext(ffmpeg_path=processor.FFMPEG, ffprobe_path=processor.FFPROBE,
                           max_workers=request.get("workers", 1), hw_encoder=request.get("hardware"),
                           env={**os.environ, "BERU_RETRY_FAILED": "0", "BERU_COPY_WORKERS": "1"})
    started = time.perf_counter()
    batch_cpu_started = time.process_time()
    try:
        if "jobs" in request:
            if request.get("serial"):
                for idx, job in enumerate(request["jobs"]):
                    audit_one(idx, job, processor.FFMPEG, ctx=context)
            else:
                processor.process_jobs(request["jobs"], processor.FFMPEG,
                                       max_workers=context.max_workers, ctx=context)
            print(json.dumps({"type": "audit_batch_result", "runs": measured_jobs,
                              "seconds": time.perf_counter() - started,
                              "python_process_cpu_seconds": time.process_time() - batch_cpu_started}), flush=True)
        else:
            audit_one(0, request["job"], processor.FFMPEG, ctx=context)
            print(json.dumps({"type": "audit_result", **measured_jobs[0]}), flush=True)
    except Exception as error:
        print(json.dumps({"type": "audit_batch_result" if "jobs" in request else "audit_result",
                          "failure": str(error), "runs": measured_jobs}), flush=True)
