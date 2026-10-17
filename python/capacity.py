import json
import logging
import os
import sys
from pathlib import Path

from encode_profiles import (
    ENCODE_PROFILES,
    effective_hw_encoder as resolve_effective_hw_encoder,
    profile_allows_hardware,
)
from job_classify import _job_dimensions, job_processing_stages
from op_shared import _env_int

logger = logging.getLogger("beru")

_resource_root = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
with (_resource_root / "resources" / "worker-policy.json").open(encoding="utf-8") as _handle:
    _POLICY = json.load(_handle)

MAX_WORKERS_CAP = _POLICY["maxWorkers"]
_ENCODER_CAPS = _POLICY["encoderCaps"]
_RAM_PER_JOB_MB = _POLICY["ramPerJobMb"]
REMUX_JOB_RAM_MB = _POLICY["remuxJobRamMb"]
_X264_PRESET_RAM_MULT = _POLICY["x264PresetRamMultipliers"]
_HEAVY_DECODE_CODECS = frozenset(_POLICY["heavyDecodeCodecs"])
_HIGH_BIT_DEPTH_PIX_TOKENS = tuple(_POLICY["highBitDepthTokens"])


def get_available_ram_mb():
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_uint32),
                ("dwMemoryLoad", ctypes.c_uint32),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]
        mem = MEMORYSTATUSEX()
        mem.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if kernel32.GlobalMemoryStatusEx(ctypes.byref(mem)):
            return max(1, int(min(mem.ullAvailPhys, mem.ullAvailPageFile) / (1024 * 1024)))
    except Exception:
        pass
    try:
        import psutil
        return int(psutil.virtual_memory().available / (1024 * 1024))
    except Exception:
        pass
    return 0


def estimate_job_ram_mb(job, hw_encoder, has_video_filters, encode_profile, source_pixels=0):
    if isinstance(job, dict) and job.get("kind") == "composition":
        return max(estimate_job_ram_mb(stage, hw_encoder, True,
            stage.get("encode_profile", encode_profile), source_pixels)
            for stage in job_processing_stages(job))
    if isinstance(job, dict) and job.get("kind") == "canvas":
        hw_encoder = None
    profile = (encode_profile or "balanced").strip().lower()
    key = "software" if (has_video_filters and not profile_allows_hardware(profile)) else \
          "nvenc" if hw_encoder == "h264_nvenc" else \
          "qsv" if hw_encoder == "h264_qsv" else \
          "amf" if hw_encoder == "h264_amf" else \
          "mf" if hw_encoder == "h264_mf" else "software"
    per_job = _RAM_PER_JOB_MB.get(key, 512)
    job = job if isinstance(job, dict) else None
    if key == "software":
        preset = str(
            (job or {}).get("speed_preset")
            or (ENCODE_PROFILES.get(profile) or {}).get("preset")
            or "fast"
        ).strip().lower()
        per_job = int(per_job * _X264_PRESET_RAM_MULT.get(preset, 1.0))
    codec = str((job or {}).get("video_codec") or "").lower()
    if codec in _HEAVY_DECODE_CODECS:
        per_job = int(per_job * _POLICY["ramMultipliers"]["heavyDecode"])
    pix_fmt = str((job or {}).get("pix_fmt") or "").lower()
    if any(token in pix_fmt for token in _HIGH_BIT_DEPTH_PIX_TOKENS):
        per_job = int(per_job * _POLICY["ramMultipliers"]["highBitDepth"])
    if has_video_filters:
        per_job = int(per_job * _POLICY["ramMultipliers"]["filters"])
    if not profile_allows_hardware(profile) or (
        profile == "quality" and not hw_encoder
    ):
        per_job = int(per_job * _POLICY["ramMultipliers"]["softwareQuality"])
    pixels = source_pixels
    if job:
        w, h = _job_dimensions(job)
        if w > 0 and h > 0:
            pixels = w * h
    if pixels >= 3840 * 2160:
        per_job = int(per_job * _POLICY["ramMultipliers"]["ultraHd"])
    elif pixels >= 1920 * 1080:
        per_job = int(per_job * _POLICY["ramMultipliers"]["fullHd"])
    return max(_POLICY["minimumJobRamMb"], per_job)


def max_estimated_job_ram_mb(jobs, hw_encoder, has_video_filters, encode_profile):
    return max(
        (
            estimate_job_ram_mb(job, hw_encoder, has_video_filters, encode_profile)
            for job in jobs
            if isinstance(job, dict)
        ),
        default=0,
    )


def _memory_cap_workers(
    hw_encoder,
    max_source_pixels,
    desired_workers,
    has_video_filters=False,
    encode_profile="balanced",
    jobs=None,
):
    avail_mb = get_available_ram_mb()
    if avail_mb <= 0:
        return desired_workers
    per_job = max_estimated_job_ram_mb(
        jobs or [], hw_encoder, has_video_filters, encode_profile
    )
    if per_job <= 0:
        per_job = estimate_job_ram_mb(
            None,
            hw_encoder,
            has_video_filters,
            encode_profile,
            source_pixels=max_source_pixels,
        )
    cap = max(1, int((avail_mb * _POLICY["memoryBudgetFraction"]) / per_job))
    return max(1, min(cap, desired_workers, MAX_WORKERS_CAP))


def resolve_max_workers(
    hw_encoder,
    job_count,
    max_source_pixels=0,
    *,
    consider_memory=True,
    has_video_filters=False,
    encode_profile=None,
    jobs=None,
    env=None,
):
    """Pick parallel job count: env override, then GPU/CPU-aware caps (balanced | conservative)."""
    env = os.environ if env is None else env
    env_workers = _env_int("BERU_WORKERS", 0, env=env)
    if env_workers > 0:
        return max(1, min(env_workers, job_count, MAX_WORKERS_CAP))

    mode = (env.get("BERU_WORKERS_MODE") or "balanced").strip().lower()
    if mode not in _ENCODER_CAPS:
        mode = "balanced"

    caps = _ENCODER_CAPS[mode]
    cpus = os.cpu_count() or 4
    profile = (
        encode_profile or env.get("BERU_ENCODE_PROFILE") or "balanced"
    ).strip().lower()
    effective_hw_encoder = resolve_effective_hw_encoder(profile, hw_encoder)

    if effective_hw_encoder:
        cap = caps.get(effective_hw_encoder, caps.get("h264_nvenc", 2))
        workers = max(1, min(cap, job_count))
    else:
        if mode == "conservative":
            workers = max(1, min(max(2, cpus - 1), 6, job_count))
        else:
            cpu_cap = min(max(2, cpus - 2), 8)
            workers = max(1, min(cpu_cap, job_count))

    if max_source_pixels >= 3840 * 2160:
        workers = min(workers, 2)

    quality_software_filters = profile == "quality" and not effective_hw_encoder
    if has_video_filters and (not profile_allows_hardware(profile) or quality_software_filters):
        workers = min(workers, 2)
    elif has_video_filters and max_source_pixels >= 1920 * 1080:
        workers = min(workers, max(3, min(6, cpus - 4)))

    if consider_memory:
        workers = _memory_cap_workers(
            effective_hw_encoder,
            max_source_pixels,
            workers,
            has_video_filters=has_video_filters,
            encode_profile=profile,
            jobs=jobs,
        )

    return workers


def resolve_copy_workers(copy_count, *, env=None):
    """Concurrent stream-copy slots. Remux/native copy is pure disk I/O, so a
    small bound saturates throughput without starving the encode pool;
    BERU_COPY_WORKERS overrides the default of 2."""
    if copy_count <= 0:
        return 0
    workers = _env_int("BERU_COPY_WORKERS", 0, env=env)
    if workers > 0:
        return max(1, min(workers, copy_count, MAX_WORKERS_CAP))
    return max(1, min(2, copy_count))
