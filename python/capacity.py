"""Worker-count and RAM-capacity policy for processor batches."""

import logging
import os

from encode_profiles import (
    ENCODE_PROFILES,
    effective_hw_encoder as resolve_effective_hw_encoder,
    profile_allows_hardware,
)
from job_classify import _job_dimensions
from op_shared import _env_int

logger = logging.getLogger("beru")

MAX_WORKERS_CAP = 16

_ENCODER_CAPS = {
    "conservative": {
        "h264_mf": 1,
        "h264_nvenc": 2,
        "h264_qsv": 2,
        "h264_amf": 2,
    },
    "balanced": {
        "h264_mf": 1,
        "h264_nvenc": 5,
        "h264_qsv": 5,
        "h264_amf": 4,
    },
}


def _get_available_ram_mb():
    """Return available memory in MB, constrained by Windows commit headroom."""
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


_RAM_PER_JOB_MB = {
    "software": 512,
    "nvenc": 256,
    "qsv": 192,
    "amf": 128,
    "mf": 64,
}

_REMUX_JOB_RAM_MB = 128


_X264_PRESET_RAM_MULT = {
    "ultrafast": 0.6,
    "superfast": 0.7,
    "veryfast": 0.8,
    "faster": 0.9,
    "fast": 1.0,
    "medium": 1.3,
    "slow": 1.6,
    "slower": 1.9,
    "veryslow": 2.2,
}

_HEAVY_DECODE_CODECS = frozenset({"hevc", "h265", "av1", "vp9", "prores", "wmv3"})

_HIGH_BIT_DEPTH_PIX_TOKENS = ("p10", "p12", "p16", "10le", "10be", "12le", "12be", "16le", "16be")


def _estimate_job_ram_mb(job, hw_encoder, has_video_filters, encode_profile, source_pixels=0):
    """Estimate peak RAM (MB) for one job, using job metadata when available."""
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
        per_job = int(per_job * 1.25)
    pix_fmt = str((job or {}).get("pix_fmt") or "").lower()
    if any(token in pix_fmt for token in _HIGH_BIT_DEPTH_PIX_TOKENS):
        per_job = int(per_job * 1.5)
    if has_video_filters:
        per_job = int(per_job * 1.5)
    if not profile_allows_hardware(profile) or (
        profile == "quality" and not hw_encoder
    ):
        per_job = int(per_job * 1.35)
    pixels = source_pixels
    if job:
        w, h = _job_dimensions(job)
        if w > 0 and h > 0:
            pixels = w * h
    if pixels >= 3840 * 2160:
        per_job = int(per_job * 2.5)
    elif pixels >= 1920 * 1080:
        per_job = int(per_job * 1.5)
    return max(64, per_job)


def _max_estimated_job_ram_mb(jobs, hw_encoder, has_video_filters, encode_profile):
    return max(
        (
            _estimate_job_ram_mb(job, hw_encoder, has_video_filters, encode_profile)
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
    """Clamp worker count based on available RAM."""
    avail_mb = _get_available_ram_mb()
    if avail_mb <= 0:
        return desired_workers
    per_job = _max_estimated_job_ram_mb(
        jobs or [], hw_encoder, has_video_filters, encode_profile
    )
    if per_job <= 0:
        per_job = _estimate_job_ram_mb(
            None,
            hw_encoder,
            has_video_filters,
            encode_profile,
            source_pixels=max_source_pixels,
        )
    cap = max(1, int((avail_mb * 0.8) / per_job))
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
