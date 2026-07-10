#!/usr/bin/env python3
"""
Beru Video Processor
Reads a JSON job manifest and processes videos with:
  - Text overlay (via drawtext filter)
  - Blur regions (via boxblur + crop overlay)
  - Crop regions
  - Delogo (inpaint / blur / color fill)
Outputs progress as JSON lines to stdout.
"""

import base64
import json
import re
import platform
import logging
import logging.handlers
import subprocess
import sys
import os
import shutil
import time
import threading
import concurrent.futures
from collections import deque
from pathlib import Path

from encode_profiles import (
    ENCODE_PROFILES,
    effective_hw_encoder as resolve_effective_hw_encoder,
    profile_allows_hardware,
)
from batch_errors import (
    format_processing_error,
    is_hardware_encode_error,
    is_resource_pressure_error,
    remove_partial_output,
)

# Pure helpers extracted into sibling modules (kept stateless & un-patched so
# they are safe outside this module's single namespace — the JS test suite
# monkeypatches processor.X heavily, so anything callable through a patched
# name MUST stay in this file).  Re-exported below for the Python smoke tests.
from op_shared import (
    VALID_DELOGO_METHODS,
    _build_enable_clause,
    _coerce_float,
    _coerce_int,
    _is_op_time_disabled,
    _normalize_operation,
    _optimize_delogo_for_speed,
    _overlay_opts,
    _region_to_pixels,
)
from color_validation import _validate_drawtext_color
from delogo_chains import (
    _build_cleanup_filter,
    _build_delogo_chain,
    _build_mirror_patch,
    _build_padded_region,
    _fit_delogo_rect,
)
from text_layout_helpers import (
    _apply_letter_spacing_fallback,
    _build_region_bg_drawbox,
    _estimate_char_width,
    _fit_font_size,
    _text_bg_enabled,
    _text_box_pad,
    _text_clusters,
    _text_layout_bounds,
    _truncate_text,
    _wrap_text_to_width,
)

FFMPEG = os.environ.get("BERU_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("BERU_FFPROBE", "ffprobe")
JOB_MANIFEST_TYPE = "beru-job-manifest"
JOB_MANIFEST_VERSION = 1

VIDEO_INPUT_EXTENSIONS = frozenset(
    {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg"}
)
VIDEO_OUTPUT_EXTENSIONS = frozenset({".mp4", ".mov", ".avi", ".mkv", ".webm"})
IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"})
FONT_EXTENSIONS = frozenset({".ttf", ".otf", ".ttc"})


def validate_media_path(path, allowed_root, allowed_extensions):
    """Return a canonical media path constrained to an approved root and extension."""
    if not isinstance(path, (str, os.PathLike)):
        raise ValueError("Media path must be a string")

    raw_path = os.fspath(path)
    if not raw_path or "\x00" in raw_path or any(ord(char) < 32 or ord(char) == 127 for char in raw_path):
        raise ValueError("Media path contains forbidden characters")
    if any(part == ".." for part in re.split(r"[\\/]+", raw_path)):
        raise ValueError("Media path traversal is not allowed")

    extensions = {
        extension.lower() if str(extension).startswith(".") else f".{str(extension).lower()}"
        for extension in (allowed_extensions or ())
    }
    extension = os.path.splitext(raw_path)[1].lower()
    if not extensions or extension not in extensions:
        raise ValueError(f"Media extension is not allowed: {extension or '(none)'}")

    roots = allowed_root if isinstance(allowed_root, (list, tuple, set, frozenset)) else [allowed_root]
    canonical_path = os.path.realpath(os.path.abspath(raw_path))
    for root in roots:
        if not isinstance(root, (str, os.PathLike)) or not os.fspath(root):
            continue
        canonical_root = os.path.realpath(os.path.abspath(os.fspath(root)))
        try:
            if os.path.commonpath(
                [os.path.normcase(canonical_path), os.path.normcase(canonical_root)]
            ) == os.path.normcase(canonical_root):
                return canonical_path
        except ValueError:
            continue

    raise ValueError("Media path is outside the allowed root")


def _path_parent(path):
    return os.path.dirname(os.path.abspath(os.fspath(path)))


def _validated_job_media(job, *, require_output):
    """Validate and canonicalize every renderer-controlled media path in a job."""
    validated = dict(job)
    input_path = job.get("input_path")
    input_root = job.get("input_root") or (_path_parent(input_path) if input_path else None)
    validated["input_path"] = validate_media_path(
        input_path, input_root, VIDEO_INPUT_EXTENSIONS
    )

    if require_output:
        output_path = job.get("output_path")
        output_root = job.get("output_root") or (_path_parent(output_path) if output_path else None)
        validated["output_path"] = validate_media_path(
            output_path, output_root, VIDEO_OUTPUT_EXTENSIONS
        )

    asset_roots = job.get("asset_roots")
    operations = []
    for raw_operation in job.get("operations", []) or []:
        operation = dict(_normalize_operation(raw_operation))
        for color_field in (
            "font_color",
            "border_color",
            "text_shadow_color",
            "bg_color",
            "delogo_fill_color",
        ):
            if color_field in operation:
                operation[color_field] = _validate_drawtext_color(
                    operation[color_field], color_field
                )
        for field, extensions in (
            ("image_path", IMAGE_EXTENSIONS),
            ("delogo_image_path", IMAGE_EXTENSIONS),
            ("font_path", FONT_EXTENSIONS),
        ):
            media_path = operation.get(field)
            if not media_path:
                continue
            roots = asset_roots or _path_parent(media_path)
            operation[field] = validate_media_path(media_path, roots, extensions)
        operations.append(operation)
    validated["operations"] = operations

    watermark = job.get("watermark")
    if isinstance(watermark, dict):
        watermark = dict(watermark)
        watermark_image = watermark.get("imagePath") or watermark.get("watermark_image")
        if watermark_image:
            roots = asset_roots or _path_parent(watermark_image)
            watermark["imagePath"] = validate_media_path(
                watermark_image, roots, IMAGE_EXTENSIONS
            )
        validated["watermark"] = watermark

    return validated

FONT_DIRS = []


def _init_font_dirs():
    global FONT_DIRS
    system = platform.system()
    if system == "Windows":
        # Use WINDIR / SystemRoot env vars so non-default Windows installs
        # (e.g. Windows on D:\) resolve the correct Fonts folder.
        windir = os.environ.get("WINDIR") or os.environ.get("SystemRoot") or "C:/Windows"
        FONT_DIRS = [
            Path(windir) / "Fonts",
            # Windows 10+ per-user font directory
            Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Fonts",
        ]
    elif system == "Darwin":
        FONT_DIRS = [
            Path("/System/Library/Fonts"),
            Path("/Library/Fonts"),
            Path.home() / "Library/Fonts",
        ]
    else:
        FONT_DIRS = [
            Path("/usr/share/fonts"),
            Path("/usr/local/share/fonts"),
            Path.home() / ".fonts",
        ]


_init_font_dirs()

_SYSTEM_FONTS_CACHE = None


def _windows_registry_fonts():
    """Return Windows font display names mapped to their installed files."""
    if platform.system() != "Windows":
        return {}
    try:
        import winreg
    except ImportError:
        return {}

    fonts = {}
    registry_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            key = winreg.OpenKey(hive, registry_path)
        except OSError:
            continue
        try:
            value_count = winreg.QueryInfoKey(key)[1]
            for index in range(value_count):
                try:
                    display_name, raw_path, _kind = winreg.EnumValue(key, index)
                except OSError:
                    continue
                if not isinstance(display_name, str) or not isinstance(raw_path, str):
                    continue
                filename = raw_path.split(",", 1)[0].strip()
                font_path = Path(filename)
                if not font_path.is_absolute():
                    windir = os.environ.get("WINDIR") or os.environ.get("SystemRoot") or "C:/Windows"
                    font_path = Path(windir) / "Fonts" / filename
                if not font_path.exists():
                    continue
                # Skip non-renderable font files (e.g. legacy .fon). _resolve_font
                # validates against FONT_EXTENSIONS and would otherwise raise,
                # propagating out of build_drawtext and failing the whole job even
                # when a usable .ttf/.otf/.ttc for the same family exists.
                if font_path.suffix.lower() not in FONT_EXTENSIONS:
                    continue

                clean_name = re.sub(r"\s+\([^)]*\)\s*$", "", display_name).strip()
                aliases = [clean_name]
                if " & " in clean_name:
                    aliases.extend(part.strip() for part in clean_name.split(" & "))
                for alias in aliases:
                    if alias:
                        fonts[alias.lower()] = (str(font_path), font_path.stem)
        finally:
            winreg.CloseKey(key)
    return fonts


def get_system_fonts():
    """Return a dict mapping lowercase font stem -> (full_path, stem).
    Cached globally for performance."""
    global _SYSTEM_FONTS_CACHE
    if _SYSTEM_FONTS_CACHE is not None:
        return _SYSTEM_FONTS_CACHE

    fonts = {}
    for font_dir in FONT_DIRS:
        if not font_dir.exists():
            continue
        for pattern in ["*.ttf", "*.otf", "*.ttc"]:
            for f in font_dir.rglob(pattern):
                stem = f.stem
                fonts[stem.lower()] = (str(f), stem)
    fonts.update(_windows_registry_fonts())
    _SYSTEM_FONTS_CACHE = fonts
    return fonts


def _font_name_key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _font_style_candidates(font_family, font_weight=None, italic=False, bold=False):
    try:
        weight = int(font_weight)
    except (TypeError, ValueError):
        weight = 700 if bold else 400

    if weight <= 200:
        weights = ["thin", "light"]
    elif weight <= 350:
        weights = ["light"]
    elif weight <= 450:
        weights = []
    elif weight <= 550:
        weights = ["medium", "semibold"]
    elif weight <= 650:
        weights = ["semibold", "bold", "medium"]
    elif weight <= 800:
        weights = ["bold", "semibold"]
    else:
        weights = ["black", "bold"]

    candidates = []
    if italic:
        candidates.extend(f"{font_family} {label} italic" for label in weights)
        candidates.extend(f"{font_family} {label} oblique" for label in weights)
        candidates.extend([f"{font_family} italic", f"{font_family} oblique"])
    else:
        candidates.extend(f"{font_family} {label}" for label in weights)
    candidates.append(font_family)
    return candidates


# Memoize _resolve_font results: system fonts don't change during a process
# lifetime, and the per-call work (normalized_fonts dict rebuild + os.path.isfile
# stats over every candidate) is repeated for identical args across jobs.
_resolve_font_cache = {}
_resolve_font_cache_lock = threading.Lock()


def _resolve_font(font_family, font_weight=None, italic=False, bold=False):
    """Resolve a font family name to a fontfile path or fallback name.
    Returns (option_key, value, is_fontfile) where option_key is 'fontfile' or 'font'."""
    cache_key = (font_family, font_weight, italic, bold)
    cached = _resolve_font_cache.get(cache_key)
    if cached is not None:
        return cached

    fonts = get_system_fonts()
    normalized_fonts = {_font_name_key(name): value for name, value in fonts.items()}

    def _format_fontfile(full_path):
        """Escape a font path for use in an FFmpeg drawtext filter option."""
        return full_path.replace("\\", "/").replace(":", "\\:")

    result = None
    for candidate in _font_style_candidates(font_family, font_weight, italic, bold):
        match = fonts.get(candidate.lower()) or normalized_fonts.get(_font_name_key(candidate))
        if match:
            full_path, _stem = match
            # Validate the font file actually exists on this machine — the font
            # registry may reference a file that was removed or lives on a
            # different drive.  Without this check FFmpeg raises ENOENT.
            if os.path.isfile(full_path):
                validate_media_path(full_path, _path_parent(full_path), FONT_EXTENSIONS)
                result = ("fontfile", _format_fontfile(full_path), True)
                break
            logger.debug("Font file missing, skipping: %s", full_path)

    if result is None:
        # Try partial match — same existence check.
        key = _font_name_key(font_family)
        for fkey, (fpath, _) in fonts.items():
            normalized_key = _font_name_key(fkey)
            if key in normalized_key or normalized_key in key:
                if os.path.isfile(fpath):
                    validate_media_path(fpath, _path_parent(fpath), FONT_EXTENSIONS)
                    result = ("fontfile", _format_fontfile(fpath), True)
                    break
                logger.debug("Font file missing (partial), skipping: %s", fpath)

    if result is None:
        # Fallback: let FFmpeg try fontconfig / system lookup
        result = ("font", font_family, False)

    with _resolve_font_cache_lock:
        _resolve_font_cache[cache_key] = result
    return result


def setup_logging():
    """Configure structured logging to rotating file and stderr."""
    logger = logging.getLogger("beru")
    logger.setLevel(logging.DEBUG)

    if not any(getattr(handler, "_beru_stderr", False) for handler in logger.handlers):
        sh = logging.StreamHandler(sys.stderr)
        sh._beru_stderr = True
        sh.setLevel(logging.INFO)
        sh.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
        logger.addHandler(sh)

    try:
        log_dir = Path(os.environ.get("BERU_LOG_DIR", Path.home() / ".beru" / "logs"))
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "processor.log"
        already_has_file_handler = any(
            isinstance(handler, logging.handlers.RotatingFileHandler)
            and Path(handler.baseFilename) == log_path
            for handler in logger.handlers
        )
        if not already_has_file_handler:
            fh = logging.handlers.RotatingFileHandler(
                log_path, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
            )
            fh.setLevel(logging.DEBUG)
            fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
            logger.addHandler(fh)
    except OSError as exc:
        logger.warning("File logging disabled: %s", exc)

    return logger


logger = setup_logging()

# Audio codecs that can be stream-copied into each container (no re-encode).
_AUDIO_COPY_CODECS = {
    ".mp4": frozenset({"aac", "mp3", "mp4a"}),
    ".mov": frozenset({"aac", "mp3", "alac"}),
    ".m4v": frozenset({"aac"}),
    ".mkv": frozenset({"aac", "mp3", "opus", "flac", "vorbis", "eac3", "ac3"}),
    ".avi": frozenset({"mp3", "ac3", "pcm_s16le", "pcm_s24le"}),
}

_HW_ENCODER_CACHE = None
_DRAWTEXT_OPTIONS_CACHE = None
_DRAWTEXT_OPTIONS_CACHE_FOR = None


def _test_hw_encoder_real(ffmpeg_path, encoder):
    """Smoke-test the encoder with a tiny 1-frame encode to verify it actually works."""
    test_src = "testsrc=duration=0.1:size=320x240:rate=1"
    preset_args = (
        ["-preset", "p1"] if encoder == "h264_nvenc"
        else ["-preset", "veryfast"] if encoder == "h264_qsv"
        else []
    )
    try:
        result = subprocess.run(
            [
                ffmpeg_path, "-hide_banner", "-f", "lavfi", "-i", test_src,
                "-c:v", encoder, *preset_args, "-frames:v", "1",
                "-f", "null", "-",
            ],
            capture_output=True, text=True, timeout=20,
        )
        if result.returncode == 0:
            return True
        err = (result.stderr or "")[:500]
        logger.info("Encoder %s probe failed: %s", encoder, err)
        return False
    except Exception as e:
        logger.info("Encoder %s probe exception: %s", encoder, e)
        return False


def detect_hw_encoder(ffmpeg_path, *, force_test=False):
    """Detect first usable hardware H.264 encoder.

    Cached for process lifetime. If force_test is True, also validates the
    encoder with a real 1-frame encode (recommended before a batch run).
    """
    global _HW_ENCODER_CACHE
    if _HW_ENCODER_CACHE is not None and not force_test:
        return _HW_ENCODER_CACHE or None

    encoders_text = ""
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=15,
        )
        encoders_text = (result.stdout or "") + (result.stderr or "")
    except Exception as e:
        logger.warning("HW encoder detection failed: %s", e)
        _HW_ENCODER_CACHE = ""
        return None

    if platform.system() == "Windows":
        priority = ["h264_nvenc", "h264_qsv", "h264_mf", "h264_amf"]
    elif platform.system() == "Darwin":
        priority = ["h264_videotoolbox", "h264_nvenc", "h264_qsv"]
    else:
        priority = ["h264_nvenc", "h264_vaapi", "h264_qsv", "h264_amf"]

    candidates = [enc for enc in priority if enc in encoders_text]

    if force_test and candidates:
        probe_parallel = (os.environ.get("BERU_HW_PROBE_PARALLEL") or "0").strip().lower() in (
            "1", "true", "yes", "on",
        )
        if probe_parallel and len(candidates) > 1:
            # Run all 1-frame test encodes concurrently, then pick the
            # highest-priority encoder that succeeded. Each probe can take up
            # to 20s; parallelizing cuts pre-flight from O(n*20s) to ~20s max.
            results = {}
            with concurrent.futures.ThreadPoolExecutor(max_workers=len(candidates)) as pool:
                future_map = {
                    pool.submit(_test_hw_encoder_real, ffmpeg_path, enc): enc
                    for enc in candidates
                }
                for future in concurrent.futures.as_completed(future_map):
                    enc = future_map[future]
                    try:
                        results[enc] = future.result()
                    except Exception as e:
                        logger.info("Encoder %s probe exception: %s", enc, e)
                        results[enc] = False
            for enc in candidates:  # respect priority order
                if results.get(enc):
                    _HW_ENCODER_CACHE = enc
                    logger.info("Using hardware encoder: %s (verified, parallel)", enc)
                    return enc
        else:
            for enc in candidates:
                if _test_hw_encoder_real(ffmpeg_path, enc):
                    _HW_ENCODER_CACHE = enc
                    logger.info("Using hardware encoder: %s (verified)", enc)
                    return enc
    else:
        for enc in candidates:
            _HW_ENCODER_CACHE = enc
            logger.info("Using hardware encoder: %s", enc)
            return enc

    _HW_ENCODER_CACHE = ""
    return None


def build_hwaccel_args(hw_encoder, has_video_filters=False):
    """Hardware decode when there is no CPU filter graph (filters need system memory)."""
    if not hw_encoder or has_video_filters or os.environ.get("BERU_HWACCEL", "1") == "0":
        return []
    return ["-hwaccel", "auto"]


def _get_drawtext_options():
    """Return supported drawtext option names for the active FFmpeg binary."""
    global _DRAWTEXT_OPTIONS_CACHE, _DRAWTEXT_OPTIONS_CACHE_FOR
    if _DRAWTEXT_OPTIONS_CACHE is not None and _DRAWTEXT_OPTIONS_CACHE_FOR == FFMPEG:
        return _DRAWTEXT_OPTIONS_CACHE

    options = set()
    try:
        result = subprocess.run(
            [FFMPEG, "-hide_banner", "-h", "filter=drawtext"],
            capture_output=True, text=True, timeout=10,
        )
        help_text = (result.stdout or "") + (result.stderr or "")
        options = set(re.findall(r"^\s+([A-Za-z0-9_]+)\s+<", help_text, re.MULTILINE))
    except Exception as e:
        logger.warning("drawtext option detection failed: %s", e)

    _DRAWTEXT_OPTIONS_CACHE = options
    _DRAWTEXT_OPTIONS_CACHE_FOR = FFMPEG
    return options


def _drawtext_supports(option_name):
    return option_name in _get_drawtext_options()


MAX_WORKERS_CAP = 16
AUTO_TARGET_WORKERS = 5

_ENCODER_CAPS = {
    "conservative": {
        "h264_mf": 1,
        "h264_nvenc": 2,
        "h264_qsv": 2,
        "h264_amf": 2,
        "h264_vaapi": 2,
        "h264_videotoolbox": 2,
    },
    "balanced": {
        "h264_mf": 1,
        "h264_nvenc": 5,
        "h264_qsv": 5,
        "h264_amf": 4,
        "h264_vaapi": 4,
        "h264_videotoolbox": 4,
    },
}

# Set in process_jobs so each FFmpeg child uses proportional filter threads.
# This is safe because the processing lock (beginProcessingRun in JS) ensures
# only one batch runs at a time. Do NOT read or write this from multiple
# concurrent batches — it is single-batch state.
_BATCH_ACTIVE_WORKERS = 1


def build_filter_thread_args(active_workers=None):
    """Parallelize filter graph; fewer threads per job when many jobs run at once."""
    workers = active_workers if active_workers is not None else _BATCH_ACTIVE_WORKERS
    cpus = os.cpu_count() or 4
    n = max(1, min(4, cpus // max(1, int(workers))))
    return ["-filter_threads", str(n), "-filter_complex_threads", str(n)]


def resolve_x264_threads(active_workers=None):
    """Bound libx264 threads per job so CPU fallback batches do not exhaust RAM."""
    workers = active_workers if active_workers is not None else _BATCH_ACTIVE_WORKERS
    cpus = os.cpu_count() or 4
    return max(1, min(8, cpus // max(1, int(workers))))


def build_audio_args(output_path, src_audio_codec, src_audio_channels=0):
    """Copy audio when the container supports the source codec; else AAC.

    When re-encoding to AAC, preserve the source channel layout (mono → mono,
    5.1 → 5.1) so surround sources don't silently downmix to stereo.
    """
    ext = os.path.splitext(output_path)[1].lower()
    codec = (src_audio_codec or "").lower()
    if codec and codec in _AUDIO_COPY_CODECS.get(ext, frozenset()):
        return ["-map", "0:a?", "-c:a", "copy"]
    args = ["-map", "0:a?", "-c:a", "aac", "-b:a", "192k"]
    channels = int(src_audio_channels or 0)
    if 1 <= channels <= 16:
        args += ["-ac", str(channels)]
    return args


def build_encode_args(ffmpeg_path, profile_name, job, force_software=False, hw_encoder=None):
    """Return ffmpeg video encode argument list for the given profile.

    If hw_encoder is provided (from batch pre-flight), it is used directly
    without re-detecting.  This avoids re-probing and allows the batch-level
    pre-flight test to skip a broken GPU path entirely.
    """
    profile_key = (profile_name or "balanced").strip().lower()
    profile = ENCODE_PROFILES.get(profile_key, ENCODE_PROFILES["balanced"])
    use_hw = not force_software and profile_allows_hardware(profile_name)
    if hw_encoder is not None and use_hw:
        hw = hw_encoder
    elif use_hw:
        hw = detect_hw_encoder(ffmpeg_path)
    else:
        hw = None

    if hw == "h264_nvenc":
        cq = profile.get("hw_cq", 23)
        nv_preset = profile.get("nvenc_preset") or "p4"
        return ["-c:v", "h264_nvenc", "-preset", nv_preset, "-rc", "vbr", "-cq", str(cq)]

    if hw == "h264_qsv":
        gq = profile.get("hw_cq", 23)
        return ["-c:v", "h264_qsv", "-global_quality", str(gq)]

    if hw == "h264_mf":
        # MediaFoundation on Windows — rate control via quality scale
        gq = profile.get("hw_cq", 23)
        return ["-c:v", "h264_mf", "-rate_control", "quality", "-quality", str(gq)]

    if hw == "h264_amf":
        quality = (
            "speed" if profile_key == "fast"
            else "quality" if profile_key == "quality"
            else "balanced"
        )
        return ["-c:v", "h264_amf", "-quality", quality]

    if hw == "h264_videotoolbox":
        q = max(1, min(100, 100 - (profile.get("hw_cq") or 23) * 2))
        return ["-c:v", "h264_videotoolbox", "-q:v", str(q)]

    if hw == "h264_vaapi":
        qp = profile.get("hw_cq", 23)
        return ["-c:v", "h264_vaapi", "-qp", str(qp)]

    # Software fallback (libx264) — cap threads to avoid RAM exhaustion when
    # many CPU jobs run concurrently.
    preset = job.get("speed_preset") or profile["preset"]
    threads = resolve_x264_threads()
    return [
        "-c:v", "libx264",
        "-crf", str(profile["crf"]),
        "-preset", preset,
        "-threads", str(threads),
    ]


def _get_available_ram_mb():
    """Return available physical RAM in MB, or 0 if detection fails."""
    try:
        import psutil
        return int(psutil.virtual_memory().available / (1024 * 1024))
    except Exception:
        pass
    try:
        if platform.system() == "Windows":
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
                return int(mem.ullAvailPhys / (1024 * 1024))
    except Exception:
        pass
    return 0


# Rough per-job memory estimates for 1080p with common presets (MB).
# Values derived from typical x264/NVENC memory usage at 1080p.
_RAM_PER_JOB_MB = {
    "software": 512,   # libx264
    "nvenc": 256,    # h264_nvenc
    "qsv": 128,      # h264_qsv
    "amf": 128,      # h264_amf
    "mf": 64,        # h264_mf
    "vaapi": 128,    # h264_vaapi
    "videotoolbox": 128,
}


def _memory_cap_workers(
    hw_encoder,
    job_count,
    max_source_pixels,
    desired_workers,
    has_video_filters=False,
    encode_profile="balanced",
):
    """Clamp worker count based on available RAM."""
    avail_mb = _get_available_ram_mb()
    if avail_mb <= 0:
        return desired_workers
    profile = (encode_profile or "balanced").strip().lower()
    key = "software" if (has_video_filters and not profile_allows_hardware(profile)) else \
          "nvenc" if hw_encoder == "h264_nvenc" else \
          "qsv" if hw_encoder == "h264_qsv" else \
          "amf" if hw_encoder == "h264_amf" else \
          "mf" if hw_encoder == "h264_mf" else \
          "vaapi" if hw_encoder == "h264_vaapi" else \
          "videotoolbox" if hw_encoder == "h264_videotoolbox" else "software"
    per_job = _RAM_PER_JOB_MB.get(key, 512)
    if has_video_filters:
        per_job = int(per_job * 1.5)
    if not profile_allows_hardware(profile) or (
        profile == "quality" and not hw_encoder
    ):
        per_job = int(per_job * 1.35)
    # 4K+ needs more RAM per encode.
    if max_source_pixels >= 3840 * 2160:
        per_job = int(per_job * 2.5)
    elif max_source_pixels >= 1920 * 1080:
        per_job = int(per_job * 1.5)
    # Leave 20% headroom for OS / other apps.
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
):
    """Pick parallel job count: env override, then GPU/CPU-aware caps (balanced | conservative)."""
    env_raw = os.environ.get("BERU_WORKERS", "0") or "0"
    try:
        env_workers = int(env_raw)
    except ValueError:
        env_workers = 0
    if env_workers > 0:
        return max(1, min(env_workers, job_count, MAX_WORKERS_CAP))

    mode = (os.environ.get("BERU_WORKERS_MODE") or "balanced").strip().lower()
    if mode not in _ENCODER_CAPS:
        mode = "balanced"

    caps = _ENCODER_CAPS[mode]
    cpus = os.cpu_count() or 4
    profile = (
        encode_profile or os.environ.get("BERU_ENCODE_PROFILE") or "balanced"
    ).strip().lower()
    effective_hw_encoder = resolve_effective_hw_encoder(profile, hw_encoder)

    if effective_hw_encoder:
        cap = caps.get(effective_hw_encoder, caps.get("h264_nvenc", 2))
        workers = max(1, min(cap, job_count))
        if (
            mode == "balanced"
            and effective_hw_encoder != "h264_mf"
            and job_count >= AUTO_TARGET_WORKERS
        ):
            workers = max(workers, min(AUTO_TARGET_WORKERS, job_count, cap))
    else:
        if mode == "conservative":
            workers = max(1, min(max(2, cpus - 1), 6, job_count))
        else:
            cpu_cap = min(max(2, cpus - 2), 8)
            workers = max(1, min(cpu_cap, job_count))
            if job_count >= AUTO_TARGET_WORKERS:
                workers = max(workers, min(AUTO_TARGET_WORKERS, job_count, cpu_cap))

    # Reduce parallel 4K+ encodes to limit VRAM/RAM spikes.
    if max_source_pixels >= 3840 * 2160:
        workers = min(workers, 2)

    quality_software_filters = profile == "quality" and not effective_hw_encoder
    if has_video_filters and (not profile_allows_hardware(profile) or quality_software_filters):
        workers = min(workers, 2)
    elif has_video_filters and max_source_pixels >= 1920 * 1080:
        workers = min(workers, 3)

    if consider_memory:
        workers = _memory_cap_workers(
            effective_hw_encoder,
            job_count,
            max_source_pixels,
            workers,
            has_video_filters=has_video_filters,
            encode_profile=profile,
        )

    return workers


def job_video_info(job, input_path):
    """Use metadata from the job when Electron already probed the file."""
    jw = int(job.get("source_width") or job.get("width") or 0)
    jh = int(job.get("source_height") or job.get("height") or 0)
    duration = float(job.get("video_duration") or 0)
    frame_rate = float(job.get("frame_rate") or 0)
    if jw > 0 and jh > 0 and duration > 0:
        return {
            "width": jw,
            "height": jh,
            "duration": duration,
            "pix_fmt": job.get("pix_fmt") or "yuv420p",
            "frame_rate": frame_rate,
            "audio_codec": job.get("audio_codec") or "",
            "audio_channels": int(job.get("audio_channels") or 0),
            "video_codec": job.get("video_codec") or "",
        }
    probed = ffprobe(input_path)
    if jw > 0 and jh > 0:
        probed["width"] = jw
        probed["height"] = jh
    return probed


def find_ffmpeg():
    """Locate ffmpeg binary - bundled, env var, or system PATH."""
    env_ffmpeg = os.environ.get("BERU_FFMPEG")
    if env_ffmpeg and os.path.isfile(env_ffmpeg):
        return env_ffmpeg

    script_dir = Path(__file__).resolve().parent  # python/ (dev) or resources/python/ (packaged)
    project_root = script_dir.parent               # beru/ (dev) or resources/ (packaged)

    _exe = ".exe" if platform.system() == "Windows" else ""

    candidates = [
        project_root / "bin" / f"ffmpeg{_exe}",                  # dev: beru/bin/  OR  packaged: resources/bin/
    ]
    for c in candidates:
        if c.exists():
            return str(c)

    found = shutil.which("ffmpeg") or shutil.which(f"ffmpeg{_exe}")
    if found:
        return found
    return "ffmpeg"


def find_ffprobe(ffmpeg_bin):
    """Locate ffprobe alongside ffmpeg, bundled resources, or system PATH."""
    env_ffprobe = os.environ.get("BERU_FFPROBE")
    if env_ffprobe and os.path.isfile(env_ffprobe):
        return env_ffprobe

    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    _exe = ".exe" if platform.system() == "Windows" else ""

    candidates = [
        Path(ffmpeg_bin).with_name(f"ffprobe{_exe}"),
        Path(ffmpeg_bin).parent / f"ffprobe{_exe}",
        project_root / "bin" / f"ffprobe{_exe}",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    found = shutil.which("ffprobe") or shutil.which(f"ffprobe{_exe}")
    if found:
        return found
    return ffmpeg_bin.replace(f"ffmpeg{_exe}", f"ffprobe{_exe}")


def _safe_float(value, default=0.0):
    """Coerce an ffprobe field to float.

    ffprobe emits the string 'N/A' (and sometimes empty strings) for fields it
    cannot measure (bit_rate, duration on some streams). A bare float() would
    raise ValueError and, because ffprobe() wraps the whole parse in a single
    try/except, discard an otherwise-valid probe and fall back to the slow
    regex parse — or report zero dimensions for a readable file.
    """
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value, default=0):
    """Coerce an ffprobe field to int, tolerating 'N/A' / None / float strings."""
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _parse_frame_rate(rate_str):
    """Parse ffprobe frame rate string (e.g. '30000/1001' or '30') to float."""
    if not rate_str:
        return 0.0
    try:
        if "/" in rate_str:
            num, den = rate_str.split("/", 1)
            return float(num) / float(den) if float(den) != 0 else 0.0
        return float(rate_str)
    except (ValueError, ZeroDivisionError):
        return 0.0


def _empty_probe_result():
    return {"width": 0, "height": 0, "duration": 0,
            "video_codec": "", "pix_fmt": "yuv420p",
            "frame_rate": 0.0, "audio_codec": "", "audio_channels": 0}


_CHANNEL_LAYOUT_TO_COUNT = {
    "mono": 1, "1.0": 1,
    "stereo": 2, "2.0": 2,
    "2.1": 3, "3.0": 3,
    "4.0": 4, "3.1": 4, "quad": 4,
    "5.0": 5, "4.1": 5,
    "5.1": 6, "hexagonal": 6,
    "6.1": 7, "7.0": 7,
    "7.1": 8, "octagonal": 8,
    "16.0": 16,
}


def _parse_channel_layout(audio_line):
    """Extract channel count from an ffmpeg 'Audio: ...' line.

    Line shape: 'Audio: aac, 44100 Hz, stereo, fltp, 192 kb/s'.
    The layout token is the third comma-separated field after 'Audio:'.
    """
    if not audio_line:
        return 0
    m = re.search(r"Audio:\s*[^,]+,\s*[^,]+,\s*([a-z0-9.]+)\s*,", audio_line, re.I)
    if not m:
        return 0
    key = m.group(1).lower()
    if key in _CHANNEL_LAYOUT_TO_COUNT:
        return _CHANNEL_LAYOUT_TO_COUNT[key]
    parts = key.split(".")
    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
        return int(parts[0]) + int(parts[1])
    return 0


def _ffprobe_via_ffmpeg(path):
    """Fallback when ffprobe returns no JSON (common on some Windows builds)."""
    empty = _empty_probe_result()
    ffmpeg_bin = FFMPEG if FFMPEG and os.path.isfile(FFMPEG) else find_ffmpeg()
    if not ffmpeg_bin or not os.path.isfile(ffmpeg_bin):
        return empty
    try:
        result = subprocess.run(
            [ffmpeg_bin, "-hide_banner", "-i", path],
            capture_output=True, text=True, timeout=30,
        )
        text = (result.stdout or "") + (result.stderr or "")
        dur_match = re.search(
            r"Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)", text,
        )
        duration = 0.0
        if dur_match:
            duration = (
                int(dur_match.group(1)) * 3600
                + int(dur_match.group(2)) * 60
                + float(dur_match.group(3))
            )
        # Classify lines in a single pass instead of calling text.splitlines()
        # three separate times for video/audio detection.
        video_line = ""
        audio_line = ""
        for line in text.splitlines():
            if not video_line and re.search(r"\bVideo:\s*", line, re.I):
                video_line = line
            elif not audio_line and re.search(r"\bAudio:\s*", line, re.I):
                audio_line = line
            if video_line and audio_line:
                break
        res_matches = list(re.finditer(r"(\d{2,6})x(\d{2,6})", video_line or text))
        width = height = 0
        for match in res_matches:
            w, h = int(match.group(1)), int(match.group(2))
            if w > 0 and h > 0:
                width, height = w, h
                break
        if width <= 0 or height <= 0:
            return empty
        codec_match = re.search(r"Video:\s*([^,\s(]+)", video_line or text, re.I)
        audio_match = re.search(r"Audio:\s*([^,\s(]+)", audio_line, re.I)
        fps_match = re.search(r",\s*([0-9]+(?:\.[0-9]+)?)\s*fps\b", video_line or text, re.I)
        return {
            "width": width,
            "height": height,
            "duration": duration,
            "video_codec": codec_match.group(1) if codec_match else "",
            "pix_fmt": "yuv420p",
            "frame_rate": _safe_float(fps_match.group(1)) if fps_match else 0.0,
            "audio_codec": audio_match.group(1) if audio_match else "",
            "audio_channels": _parse_channel_layout(audio_line),
        }
    except Exception as e:
        logger.warning("ffmpeg probe fallback failed for %s: %s", os.path.basename(path), e)
        return empty


def ffprobe(path):
    """Get comprehensive video metadata for quality-preserving export."""
    empty = _empty_probe_result()
    if not path or not os.path.exists(path):
        return empty
    if not FFPROBE or not os.path.isfile(FFPROBE):
        logger.warning("ffprobe binary not found: %s", FFPROBE)
        return _ffprobe_via_ffmpeg(path)
    try:
        result = subprocess.run(
            [FFPROBE, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=30
        )
        raw = (result.stdout or "").strip()
        if not raw:
            err_snip = (result.stderr or "").strip()[:300]
            logger.warning(
                "ffprobe empty output for %s (exit %s): %s",
                os.path.basename(path), result.returncode, err_snip,
            )
            return _ffprobe_via_ffmpeg(path)
        info = json.loads(raw)
        fmt = info.get("format", {})
        video_stream = None
        audio_stream = None
        for stream in info.get("streams", []):
            if stream.get("codec_type") == "video" and video_stream is None:
                video_stream = stream
            elif stream.get("codec_type") == "audio" and audio_stream is None:
                audio_stream = stream

        if not video_stream:
            return _ffprobe_via_ffmpeg(path)

        return {
            "width": _safe_int(video_stream.get("width", 0)),
            "height": _safe_int(video_stream.get("height", 0)),
            "duration": _safe_float(fmt.get("duration", 0)),
            "video_codec": video_stream.get("codec_name", ""),
            "pix_fmt": video_stream.get("pix_fmt", "yuv420p"),
            "bit_rate": _safe_int(fmt.get("bit_rate", 0)) or _safe_int(video_stream.get("bit_rate", 0)),
            "frame_rate": _parse_frame_rate(video_stream.get("r_frame_rate") or video_stream.get("avg_frame_rate", "")),
            "audio_codec": audio_stream.get("codec_name", "") if audio_stream else "",
            "audio_channels": _safe_int(audio_stream.get("channels", 0)) if audio_stream else 0,
        }
    except Exception as e:
        logger.warning("ffprobe failed for %s: %s", os.path.basename(path), e)
    return _ffprobe_via_ffmpeg(path)


_DRAWTEXT_CACHE = {}
_DRAWTEXT_CACHE_LOCK = threading.Lock()
_DRAWTEXT_CACHE_ENABLED = None

_ALLOWED_DRAWTEXT_PUNCTUATION = frozenset(
    " .,!?¿¡:;'\"()_-+/&@#%$€£¥={}*"
)
def _validate_drawtext_text(value):
    for char in value:
        if char == "\n" or char.isalnum() or char in _ALLOWED_DRAWTEXT_PUNCTUATION:
            continue
        raise ValueError("Drawtext contains forbidden characters")
    return value


def _escape_drawtext_text(value):
    return (
        value.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("=", "\\=")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("%", "\\%")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\n", "\\n")
        .replace("\r", "")
    )


def _drawtext_cache_enabled():
    """Lazily read the env flag once (default off = legacy per-call rebuild)."""
    global _DRAWTEXT_CACHE_ENABLED
    if _DRAWTEXT_CACHE_ENABLED is None:
        _DRAWTEXT_CACHE_ENABLED = (
            os.environ.get("BERU_DRAWTEXT_CACHE") or "0"
        ).strip().lower() in ("1", "true", "yes", "on")
    return _DRAWTEXT_CACHE_ENABLED


def build_drawtext(op):
    """Build ffmpeg drawtext filter string from operation."""
    text = (op.get("text") or "").strip()
    if not text:
        return None
    _validate_drawtext_text(text)

    # Memoize identical ops (same text + style + pixel region) across jobs in a
    # batch. build_drawtext is a pure function of `op`, so the result is stable.
    cache_key = None
    if _drawtext_cache_enabled():
        try:
            cache_key = json.dumps(op, sort_keys=True, separators=(",", ":"))
        except (TypeError, ValueError):
            cache_key = None
        if cache_key is not None:
            cached = _DRAWTEXT_CACHE.get(cache_key)
            if cached is not None:
                return cached

    region = op.get("region", {}) or {}
    try:
        safe_margin = int(op.get("safe_margin", 0) or 0)
    except (TypeError, ValueError):
        safe_margin = 0
    safe_margin = max(0, safe_margin)

    layout = _text_layout_bounds(region, safe_margin, _text_box_pad(op))
    x = layout["x"]
    y = layout["y"]
    region_w = layout["w"]
    region_h = layout["h"]

    font_size = op.get("font_size", 32)
    try:
        line_height = float(op.get("line_height", 1.2))
    except (TypeError, ValueError):
        line_height = 1.2
    text_wrap = op.get("text_wrap", True)
    if isinstance(text_wrap, str):
        text_wrap = text_wrap.lower() not in ("0", "false", "no")
    truncate = str(op.get("truncate") or "none").lower()
    auto_fit = bool(op.get("auto_fit"))

    if auto_fit and region_w > 0 and region_h > 0:
        font_size = _fit_font_size(text, region_w, region_h, font_size, line_height, text_wrap)
    else:
        try:
            font_size = int(font_size)
        except (TypeError, ValueError):
            font_size = 32

    if text_wrap and region_w > 0:
        text = _wrap_text_to_width(text, region_w, font_size)
    if not auto_fit:
        text = _truncate_text(text, region_w, font_size, truncate)

    letter_spacing = op.get("letter_spacing", 0)
    try:
        spacing_px = int(round(float(letter_spacing)))
    except (TypeError, ValueError):
        spacing_px = 0
    native_letter_spacing = spacing_px > 0 and _drawtext_supports("spacing")
    if spacing_px > 0 and not native_letter_spacing:
        text = _apply_letter_spacing_fallback(text, spacing_px, font_size)

    # Escape the text for FFmpeg drawtext syntax
    text = _escape_drawtext_text(text)

    font_color = _validate_drawtext_color(op.get("font_color", "white"), "font_color")
    font_family = str(op.get("font_family", "Arial") or "Arial").strip()
    if not re.fullmatch(r"[\w .-]{1,100}", font_family, re.UNICODE):
        raise ValueError("font_family contains forbidden characters")
    bold = 1 if op.get("bold") else 0
    italic = 1 if op.get("italic") else 0
    font_weight = op.get("font_weight")
    if font_weight is None and bold:
        font_weight = 700
    
    # Dynamic text alignment using FFmpeg's native text_w variable
    text_align = op.get("text_align", "left")
    
    if text_align == "center" and region_w > 0:
        x_expr = f"{x} + ({region_w} - text_w) / 2"
    elif text_align == "right" and region_w > 0:
        x_expr = f"{x} + {region_w} - text_w"
    else:
        x_expr = str(x)

    vertical_align = str(op.get("vertical_align") or "top").lower()
    if vertical_align == "center" and region_h > 0:
        y_expr = f"{y} + ({region_h} - text_h) / 2"
    elif vertical_align == "bottom" and region_h > 0:
        y_expr = f"{y} + {region_h} - text_h"
    else:
        y_expr = str(y)

    font_key, font_val, is_fontfile = _resolve_font(
        font_family,
        font_weight=font_weight,
        italic=bool(italic),
        bold=bool(bold),
    )
    if is_fontfile:
        font_val = f"'{font_val}'"

    # Text opacity via fontcolor@alpha (ffmpeg drawtext supports this)
    text_opacity = op.get("text_opacity", 1)
    try:
        text_opacity = float(text_opacity)
    except (TypeError, ValueError):
        text_opacity = 1.0
    text_opacity = max(0.0, min(1.0, text_opacity))
    if text_opacity < 1.0:
        font_color = f"{font_color}@{text_opacity:.3f}"

    parts = [
        f"text='{text}'",
        f"fontsize={font_size}",
        f"fontcolor={font_color}",
        f"{font_key}={font_val}",
        f"x={x_expr}",
        f"y={y_expr}",
    ]

    # y is the top of the first text line (matches CSS content box top), not baseline.
    if _drawtext_supports("y_align"):
        parts.append("y_align=text")

    # Numeric font weight (100-900). "bold" is a convenience alias.
    if font_weight is not None and _drawtext_supports("fontweight"):
        try:
            fw = int(font_weight)
            if 100 <= fw <= 1000:
                parts.append(f"fontweight={fw}")
        except (TypeError, ValueError):
            pass

    if italic and _drawtext_supports("fontstyle"):
        parts.append("fontstyle=italic")

    # Letter spacing (drawtext spacing= pixels between glyphs; matches CSS preview)
    if native_letter_spacing:
        parts.append(f"spacing={spacing_px}")

    line_spacing_px = int(round(float(font_size) * max(0.0, line_height - 1.0)))
    if line_spacing_px > 0 and _drawtext_supports("line_spacing"):
        parts.append(f"line_spacing={line_spacing_px}")

    # Region background is rendered via drawbox in build_filter_complex (full region).
    # drawtext only paints glyphs so export matches the CSS preview overlay.

    # Border/stroke
    border_w = op.get("border_width", 0)
    if border_w > 0:
        border_color = _validate_drawtext_color(op.get("border_color", "black"), "border_color")
        parts.append(f"bordercolor={border_color}:borderw={border_w}")

    # Drop shadow. FFmpeg drawtext uses whole-pixel offsets; preview scales the
    # same operation-style values to screen pixels.
    if op.get("text_shadow_enabled"):
        shadow_color = _validate_drawtext_color(
            op.get("text_shadow_color", "black"), "text_shadow_color"
        )
        try:
            shadow_x = int(round(float(op.get("text_shadow_offset_x", 2))))
        except (TypeError, ValueError):
            shadow_x = 2
        try:
            shadow_y = int(round(float(op.get("text_shadow_offset_y", 2))))
        except (TypeError, ValueError):
            shadow_y = 2
        shadow_x = max(-64, min(64, shadow_x))
        shadow_y = max(-64, min(64, shadow_y))
        if shadow_x or shadow_y:
            parts.append(f"shadowcolor={shadow_color}:shadowx={shadow_x}:shadowy={shadow_y}")

    # Time range (enable clause)
    enable_clause = _build_enable_clause(op)
    if enable_clause:
        parts.append(enable_clause)

    filter_str = "drawtext=" + ":".join(parts)
    logger.debug("drawtext filter: %s", filter_str[:300])
    if cache_key is not None:
        with _DRAWTEXT_CACHE_LOCK:
            _DRAWTEXT_CACHE[cache_key] = filter_str
    return filter_str


def _build_watermark_filter(watermark, video_w, video_h):
    """Build FFmpeg filter for a global watermark (text or image overlay).

    Returns (filter_snippet, needs_image_input, image_path) or (None, False, None).
    """
    if not watermark or not watermark.get("enabled"):
        return None, False, None

    wm_type = watermark.get("type", "text")
    opacity = float(watermark.get("opacity", 0.5))
    position = watermark.get("position", "bottom-right")

    # Map position key to FFmpeg overlay coordinates
    margin = 10
    pos_map = {
        "top-left": f"{margin}:{margin}",
        "top-center": f"(W-w)/2:{margin}",
        "top-right": f"W-w-{margin}:{margin}",
        "center-left": f"{margin}:(H-h)/2",
        "center": "(W-w)/2:(H-h)/2",
        "center-right": f"W-w-{margin}:(H-h)/2",
        "bottom-left": f"{margin}:H-h-{margin}",
        "bottom-center": f"(W-w)/2:H-h-{margin}",
        "bottom-right": f"W-w-{margin}:H-h-{margin}",
    }
    xy = pos_map.get(position, pos_map["bottom-right"])

    if wm_type == "text":
        text = watermark.get("text", "")
        if not text.strip():
            return None, False, None
        _validate_drawtext_text(text)
        font_size = int(watermark.get("fontSize", 18))
        font_color = _validate_drawtext_color(watermark.get("fontColor", "white"), "fontColor")
        font_family = str(watermark.get("fontFamily", "Arial") or "Arial").strip()
        if not re.fullmatch(r"[\w .-]{1,100}", font_family, re.UNICODE):
            raise ValueError("fontFamily contains forbidden characters")
        # Resolve font
        font_key, font_val, is_fontfile = _resolve_font(font_family)
        if is_fontfile:
            font_val = f"'{font_val}'"
        escaped_text = _escape_drawtext_text(text)
        alpha = f"{opacity:.2f}"
        x_expr, y_expr = xy.split(":")
        dt_parts = [
            f"{font_key}={font_val}",
            f"text='{escaped_text}'",
            f"fontsize={font_size}",
            f"fontcolor={font_color}@{alpha}",
            f"x={x_expr}",
            f"y={y_expr}",
            "shadowx=1",
            "shadowy=1",
            "shadowcolor=black@0.5",
        ]
        return f"drawtext={':'.join(dt_parts)}", False, None

    elif wm_type == "image":
        img_path = watermark.get("imagePath", "")
        if not img_path or not os.path.exists(img_path):
            return None, False, None
        scale_factor = float(watermark.get("scale", 1))
        # Scale the image; default base height ~80px, adjusted by scale
        target_h = max(16, int(80 * scale_factor))
        x_expr, y_expr = xy.split(":")
        # Return filter parts; caller must add the image as an input
        return (
            f"scale=-1:{target_h},format=rgba,"
            f"colorchannelmixer=aa={opacity:.3f}",
            f"{x_expr}:{y_expr}",
            img_path,
        )

    return None, False, None


def build_filter_complex(operations, video_w, video_h, watermark=None):
    """Build ffmpeg -filter_complex argument for all operations.

    Returns (filter_str, output_label, extra_image_paths) where extra_image_paths
    is the list of image file paths to pass as additional `-loop 1 -i <path>` inputs.
    """
    filters = []
    n = 0
    image_index = {}  # path -> ffmpeg input index (1-based, 0 is the video)
    image_paths = []   # ordered list, index = ffmpeg input index - 1

    def img_input_index(path):
        if path not in image_index:
            image_index[path] = len(image_paths) + 1
            image_paths.append(path)
        return image_index[path]

    for raw_op in operations:
        op = _normalize_operation(raw_op)
        mode = op.get("mode")
        # Skip ops with an explicit empty time range (end <= start). The user's
        # intent for start=10,end=5 is NOT "apply always" — it's an invalid
        # range. Skipping matches the UI preview (isOpActive returns false for
        # e<=s) and avoids silently producing output the user didn't ask for.
        if _is_op_time_disabled(op):
            continue
        region = _region_to_pixels(op.get("region", {}), video_w, video_h)
        if not region:
            continue

        x = region["x"]
        y = region["y"]
        w = region["w"]
        h = region["h"]

        if mode == "text":
            if not (op.get("text") or "").strip():
                continue
            enable_clause = _build_enable_clause(op)
            segments = []
            if _text_bg_enabled(op):
                bg_color = op.get("bg_color", "black")
                bg_opacity = op.get("bg_opacity", 0.65)
                segments.append(
                    _build_region_bg_drawbox(region, bg_color, bg_opacity, enable_clause)
                )
            dt = build_drawtext({**op, "region": region})
            if dt:
                segments.append(dt)
            if not segments:
                continue
            chain = ",".join(segments)
            if n == 0:
                filters.append(f"[0:v]{chain}[tmp{n}]")
            else:
                filters.append(f"[tmp{n-1}]{chain}[tmp{n}]")
        elif mode == "blur":
            strength = _coerce_int(op.get("blur_strength"), 20, 1, 100)
            luma = max(1, min(100, strength // 3))
            enable_clause = _build_enable_clause(op)
            overlay_opts = f"{x}:{y}"
            if enable_clause:
                overlay_opts += f":{enable_clause}"
            if n == 0:
                filters.append(
                    f"[0:v]split[bg{n}][fg{n}];"
                    f"[bg{n}]crop={w}:{h}:{x}:{y},boxblur={luma}[blur{n}];"
                    f"[fg{n}][blur{n}]overlay={overlay_opts}[tmp{n}]"
                )
            else:
                filters.append(
                    f"[tmp{n-1}]split[bg{n}][fg{n}];"
                    f"[bg{n}]crop={w}:{h}:{x}:{y},boxblur={luma}[blur{n}];"
                    f"[fg{n}][blur{n}]overlay={overlay_opts}[tmp{n}]"
                )
        elif mode == "crop":
            enable_clause = _build_enable_clause(op)
            if enable_clause:
                # Time-bounded crop = ZOOM: during [start,end] the cropped
                # region is scaled up to fill the entire frame. Outside the
                # range the original frame shows through (overlay enable clause
                # is false). Previously this was a no-op: the crop was scaled
                # back to its own w:h and overlaid at x:y — pasting the crop
                # exactly on top of its own pixels, producing zero visible
                # change. The user's intent for "crop between t=5 and t=8" is a
                # zoom into that region, not a no-op.
                overlay_opts = f"0:0:{enable_clause}"
                if n == 0:
                    filters.append(
                        f"[0:v]split[full{n}][crop_in{n}];"
                        f"[crop_in{n}]crop={w}:{h}:{x}:{y},scale={video_w}:{video_h}:flags=fast_bilinear[cropped{n}];"
                        f"[full{n}][cropped{n}]overlay={overlay_opts}[tmp{n}]"
                    )
                else:
                    filters.append(
                        f"[tmp{n-1}]split[full{n}][crop_in{n}];"
                        f"[crop_in{n}]crop={w}:{h}:{x}:{y},scale={video_w}:{video_h}:flags=fast_bilinear[cropped{n}];"
                        f"[full{n}][cropped{n}]overlay={overlay_opts}[tmp{n}]"
                    )
            else:
                # Full-duration crop: changes output resolution. Force even
                # width/height so yuv420p / H.264 encoders accept the frame, and
                # update video_w/h so later ops target the cropped size.
                cw, ch = int(w), int(h)
                if cw % 2:
                    cw = max(2, cw - 1)
                if ch % 2:
                    ch = max(2, ch - 1)
                if n == 0:
                    filters.append(f"[0:v]crop={cw}:{ch}:{x}:{y}[tmp{n}]")
                else:
                    filters.append(f"[tmp{n-1}]crop={cw}:{ch}:{x}:{y}[tmp{n}]")
                video_w, video_h = cw, ch
        elif mode == "delogo":
            prev = f"tmp{n-1}" if n > 0 else None
            chain = _build_delogo_chain(
                {**op, "region": region}, prev, n, video_w, video_h, img_input_index
            )
            if chain:
                filters.append(chain)
            else:
                continue  # skip degenerate delogo op
        elif mode == "image":
            img_path = op.get("image_path")
            if not img_path or not os.path.exists(img_path):
                logger.warning("Image op skipped: file not found: %s", img_path)
                continue
            idx = img_input_index(img_path)
            opacity = _coerce_float(op.get("image_opacity"), 1.0, 0.0, 1.0)
            enable_clause = _build_enable_clause(op)
            overlay_opts = f"{x}:{y}"
            if enable_clause:
                overlay_opts += f":{enable_clause}"
            prev = "[0:v]" if n == 0 else f"[tmp{n-1}]"
            filters.append(
                f"[{idx}:v]scale={w}:{h},"
                f"format=rgba,"
                f"colorchannelmixer=aa={opacity:.3f}[ov{n}];"
                f"{prev}[ov{n}]overlay={overlay_opts}[tmp{n}]"
            )
        n += 1

    # Append global watermark if configured
    if watermark and watermark.get("enabled"):
        wm_type = watermark.get("type", "text")
        if wm_type == "text":
            wm_result = _build_watermark_filter(watermark, video_w, video_h)
            if wm_result and wm_result[0]:
                dt_filter = wm_result[0]
                prev = f"[tmp{n-1}]" if n > 0 else "[0:v]"
                filters.append(f"{prev}{dt_filter}[tmp{n}]")
                n += 1
        elif wm_type == "image":
            wm_result = _build_watermark_filter(watermark, video_w, video_h)
            if wm_result and len(wm_result) == 3 and wm_result[2]:
                scale_filter, overlay_pos, img_path = wm_result
                idx = img_input_index(img_path)
                prev = f"[tmp{n-1}]" if n > 0 else "[0:v]"
                filters.append(
                    f"[{idx}:v]{scale_filter}[wm{n}];"
                    f"{prev}[wm{n}]overlay={overlay_pos}[tmp{n}]"
                )
                n += 1

    if n == 0:
        return None, None, []

    return ";".join(filters), f"[tmp{n - 1}]", image_paths


MAX_RETRIES = 2
RETRY_DELAYS = [2, 5]
MAX_STDERR_LINES = 256
MAX_STDERR_CHARS = 48_000
_tr_print_lock = threading.Lock()
_last_job_progress_emit = {}
_job_progress_lock = threading.Lock()
_cancel_event = threading.Event()
_jobs_file = None
_FFMPEG_TIME_RE = re.compile(r"time=(\d+):(\d+):(\d+\.?\d*)")
_FFMPEG_SPEED_RE = re.compile(r"speed=\s*([0-9.]+)x")


def _safe_print(msg):
    """Thread-safe JSON print to stdout."""
    with _tr_print_lock:
        print(msg, flush=True)


def _check_cancelled():
    """Check if cancellation was requested via sentinel file or event."""
    if _cancel_event.is_set():
        return True
    if _jobs_file:
        cancel_file = os.path.splitext(_jobs_file)[0] + ".cancel"
        if os.path.exists(cancel_file):
            _cancel_event.set()
            return True
    return False


def _is_transient_error(stderr_text):
    """Heuristic: detect transient FFmpeg errors that warrant a retry."""
    markers = [
        "i/o error",
        "temporary failure", "resource temporarily unavailable",
        "connection reset", "broken pipe",
    ]
    lower = stderr_text.lower()
    return any(m in lower for m in markers)


def _is_hardware_encode_error(stderr_text):
    return is_hardware_encode_error(stderr_text)


def _is_resource_pressure_error(stderr_text):
    return is_resource_pressure_error(stderr_text)


class StderrBuffer:
    """Bounded stderr accumulator.

    Replaces the previous list+pop(0)+"".join() approach, which was O(n) per
    appended line (list shift and full-buffer join inside the stderr lock).
    Uses a deque(maxlen=...) for O(1) append/eviction and a running char count
    so the char-cap check is O(1) per line instead of O(total buffered chars).
    """

    __slots__ = ("_buf", "_chars", "_max_chars", "_total")

    def __init__(self, max_lines=MAX_STDERR_LINES, max_chars=MAX_STDERR_CHARS):
        self._buf = deque(maxlen=max_lines)
        self._chars = 0
        self._max_chars = max_chars
        # Unbounded, monotonically-increasing append counter. `len()` is capped
        # at `max_lines` once the deque fills, so it cannot be used to detect
        # ongoing activity (the stall detector would otherwise go blind and kill
        # healthy long encodes). This counter always increases on append.
        self._total = 0

    def append(self, line):
        self._buf.append(line)
        self._chars += len(line)
        self._total += 1
        # Evict oldest until both caps are satisfied. deque(maxlen) already
        # handles the line cap; only the char cap needs manual eviction.
        while self._chars > self._max_chars and len(self._buf) > 1:
            evicted = self._buf.popleft()
            self._chars -= len(evicted)

    def __len__(self):
        return len(self._buf)

    def total_appended(self):
        """Total lines ever appended (unbounded). Use this — not len() — to
        detect ongoing stderr activity, since len() is capped at max_lines."""
        return self._total

    def join(self):
        return "".join(self._buf)


def _retry_failed_enabled():
    flag = (os.environ.get("BERU_RETRY_FAILED") or "1").strip().lower()
    return flag not in ("0", "false", "no", "off")


def _should_retry_failed_job(result, max_workers):
    if result.get("status") != "failed":
        return False
    err = result.get("raw_error") or result.get("error") or ""
    if _is_hardware_encode_error(err):
        return True
    if max_workers > 1 and _is_resource_pressure_error(err):
        return True
    if max_workers >= 3 and "timeout" in err.lower():
        return True
    return False


def _extract_error_line(stderr_text):
    """Extract the most relevant error line from FFmpeg stderr."""
    if len(stderr_text) > MAX_STDERR_CHARS:
        stderr_text = stderr_text[-MAX_STDERR_CHARS:]
    lines = stderr_text.split("\n")
    # Prefer actionable parse/path failures over generic "Error while ..." wrappers.
    priority = ("invalid", "no such", "unable to parse")
    best_error = None
    best_any = None
    for line in reversed(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if best_any is None:
            best_any = stripped
        low = stripped.lower()
        if any(p in low for p in priority):
            return stripped[-400:]
        if best_error is None and "error" in low:
            best_error = stripped
    # Last non-empty line if nothing matched (handles missing trailing newline).
    chosen = best_error or best_any or stderr_text.strip()
    return chosen[-400:] if chosen else ""


def _remove_partial_output(output_path, input_path=None):
    return remove_partial_output(output_path, input_path, logger=logger)


def _output_path_from_ffmpeg_cmd(cmd):
    """Last non-flag argv token is typically the output file."""
    if not cmd:
        return None
    for token in reversed(cmd):
        s = str(token)
        if s and not s.startswith("-"):
            return s
    return None


def _input_path_from_ffmpeg_cmd(cmd):
    """First path argument after -i."""
    if not cmd:
        return None
    args = [str(x) for x in cmd]
    for i, token in enumerate(args):
        if token == "-i" and i + 1 < len(args):
            candidate = args[i + 1]
            if candidate and not candidate.startswith("-"):
                return candidate
    return None


def _cleanup_ffmpeg_partial(cmd):
    output_path = _output_path_from_ffmpeg_cmd(cmd)
    if output_path:
        _remove_partial_output(output_path, _input_path_from_ffmpeg_cmd(cmd))


def _should_retry_ffmpeg(stderr, attempt):
    if attempt >= MAX_RETRIES:
        return False
    text = str(stderr or "")
    if _is_transient_error(text):
        return True
    return "timeout" in text.lower()


def _format_processing_error(raw_error, *, max_workers=None):
    return format_processing_error(raw_error, max_workers=max_workers)


def _job_failed_result(job_id, raw_error, *, max_workers=None):
    user_error = _format_processing_error(raw_error, max_workers=max_workers)
    payload = {"type": "error", "index": job_id, "error": user_error}
    if raw_error and raw_error != user_error:
        payload["raw_error"] = str(raw_error)[-1000:]
    _safe_print(json.dumps(payload))
    result = {"index": job_id, "status": "failed", "error": user_error}
    if raw_error and raw_error != user_error:
        result["raw_error"] = str(raw_error)
    return result


def _job_cancelled_result(job_id):
    _safe_print(json.dumps({"type": "error", "index": job_id, "error": "Cancelled"}))
    return {"index": job_id, "status": "cancelled"}


def _emit_job_progress(job_id, percent, speed):
    """Per-video encode progress (0-100) for the renderer (throttled ~1 Hz per job)."""
    if job_id is None:
        return
    pct = round(max(0.0, min(100.0, percent)), 1)
    now = time.monotonic()
    with _job_progress_lock:
        last_t = _last_job_progress_emit.get(job_id, 0.0)
        if pct < 99.0 and (now - last_t) < 1.0:
            return
        _last_job_progress_emit[job_id] = now
    _safe_print(json.dumps({
        "type": "job_progress",
        "index": job_id,
        "percent": pct,
        "speed": speed,
    }))


def _kill_ffmpeg_process(proc):
    if proc.poll() is not None:
        return
    try:
        proc.kill()
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            pass


def _run_ffmpeg_stream(cmd, timeout_sec, job_id=None, duration_sec=0.0):
    """Run FFmpeg with bounded stderr capture, optional progress parsing, and cancel polling."""
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    stderr_lines = StderrBuffer()
    stderr_lock = threading.Lock()
    reader_done = threading.Event()
    progress_state = {"last_pct": -1.0}

    def read_stderr():
        try:
            if proc.stderr is None:
                return
            for line in proc.stderr:
                with stderr_lock:
                    stderr_lines.append(line)
                if job_id is None or duration_sec <= 0:
                    continue
                m = _FFMPEG_TIME_RE.search(line)
                if not m:
                    continue
                h, mi, sec = int(m.group(1)), int(m.group(2)), float(m.group(3))
                cur = h * 3600 + mi * 60 + sec
                pct = (cur / duration_sec) * 100.0 if duration_sec > 0 else 0.0
                sm = _FFMPEG_SPEED_RE.search(line)
                speed = float(sm.group(1)) if sm else None
                if pct - progress_state["last_pct"] >= 1.0 or pct >= 99.0:
                    _emit_job_progress(job_id, pct, speed)
                    progress_state["last_pct"] = pct
        finally:
            reader_done.set()

    threading.Thread(target=read_stderr, daemon=True).start()
    deadline = time.monotonic() + timeout_sec

    # Stall detector: if FFmpeg produces no stderr output for STALL_TIMEOUT_SEC,
    # kill it. This catches hung processes that the fixed deadline would only
    # catch after a much longer wait.
    STALL_TIMEOUT_SEC = 120
    last_output_time = time.monotonic()
    prev_total = 0
    # Only enforce the stall check when progress output is expected. With
    # -loglevel error (no duration / no job_id) a clean run may legitimately
    # emit zero stderr lines (e.g. stream copy), so the detector would false-
    # fire at STALL_TIMEOUT_SEC; for those paths we rely on the overall deadline.
    stall_enabled = job_id is not None and duration_sec > 0

    while True:
        returncode = proc.poll()
        if returncode is not None:
            break
        if _check_cancelled():
            _kill_ffmpeg_process(proc)
            reader_done.wait(timeout=1)
            _cleanup_ffmpeg_partial(cmd)
            return False, "Cancelled"
        now = time.monotonic()
        if now >= deadline:
            _kill_ffmpeg_process(proc)
            reader_done.wait(timeout=1)
            _cleanup_ffmpeg_partial(cmd)
            return False, f"Timeout after {timeout_sec}s"
        # Check for stall: compare the unbounded append counter delta to detect
        # activity. len() is capped once the deque fills (256 lines) and cannot
        # be used here — it would freeze the detector and kill healthy encodes.
        if stall_enabled:
            with stderr_lock:
                current_total = stderr_lines.total_appended()
            if current_total > prev_total:
                last_output_time = now
                prev_total = current_total
            elif now - last_output_time > STALL_TIMEOUT_SEC:
                _kill_ffmpeg_process(proc)
                reader_done.wait(timeout=1)
                _cleanup_ffmpeg_partial(cmd)
                return False, f"FFmpeg stalled (no output for {STALL_TIMEOUT_SEC}s)"
        time.sleep(0.2)

    reader_done.wait(timeout=2)
    with stderr_lock:
        stderr = stderr_lines.join()

    if returncode == 0:
        if job_id is not None and duration_sec > 0:
            _emit_job_progress(job_id, 100.0, None)
        return True, None
    return False, _extract_error_line(stderr)


def _run_ffmpeg(cmd, timeout_sec=600, job_id=None, duration_sec=0.0):
    """Run ffmpeg with retry for transient failures.

    The timeout scales with video duration when duration_sec is provided:
    at least 600s (10 min) or 3x the video duration, whichever is larger.
    This prevents false timeouts on long videos (4K, 1hr+) while keeping
    a reasonable bound for short clips.
    """
    if duration_sec > 0:
        timeout_sec = max(timeout_sec, int(duration_sec * 3))
    for attempt in range(MAX_RETRIES + 1):
        try:
            logger.debug("FFmpeg cmd: %s", " ".join(str(x) for x in cmd)[:500])
            t0 = time.perf_counter()
            ok, err = _run_ffmpeg_stream(cmd, timeout_sec, job_id, duration_sec)
            elapsed = time.perf_counter() - t0
            if ok:
                logger.info("FFmpeg finished in %.1fs (job=%s)", elapsed, job_id)
                return True, None
            stderr = err or ""
            if _should_retry_ffmpeg(stderr, attempt):
                _cleanup_ffmpeg_partial(cmd)
                logger.warning("Transient error, retry %d/%d: %s",
                               attempt + 1, MAX_RETRIES, (stderr or "")[:150])
                time.sleep(RETRY_DELAYS[attempt])
                continue
            _cleanup_ffmpeg_partial(cmd)
            return False, stderr if stderr else "Unknown error"
        except Exception as e:
            _cleanup_ffmpeg_partial(cmd)
            if attempt < MAX_RETRIES:
                logger.warning("Exception, retry %d/%d: %s", attempt + 1, MAX_RETRIES, e)
                time.sleep(RETRY_DELAYS[attempt])
                continue
            return False, str(e)


def _process_one(idx, job, ffmpeg_path, *, hw_encoder=None):
    """Process a single job. Thread-safe.

    If hw_encoder is provided (from the batch pre-flight), it is used
    directly instead of re-detecting. This avoids per-job detection overhead
    and lets the batch-level pre-flight skip a broken GPU encoder for all jobs.
    """
    if not isinstance(job, dict):
        logger.error("Job %d: invalid payload (expected object, got %s)", idx, type(job).__name__)
        return _job_failed_result(idx, "Invalid job payload", max_workers=_BATCH_ACTIVE_WORKERS)

    try:
        job = _validated_job_media(job, require_output=True)
    except ValueError as exc:
        logger.error("Job %d: rejected unsafe media path: %s", idx, exc)
        return _job_failed_result(
            job.get("id", idx), str(exc), max_workers=_BATCH_ACTIVE_WORKERS
        )

    input_path = job.get("input_path")
    output_path = job.get("output_path")
    fname = os.path.basename(input_path) if input_path else "unknown"
    # Use the job's explicit id (which is the queue index) so single-job
    # runs and batch runs report the same identifier the renderer expects.
    job_id = job.get("id", idx)

    if _check_cancelled():
        return {"index": job_id, "status": "cancelled"}

    if not input_path or not os.path.exists(input_path):
        raw_err = f"Input not found: {input_path}"
        logger.error("Job %d: %s", idx, raw_err)
        return _job_failed_result(job_id, raw_err, max_workers=_BATCH_ACTIVE_WORKERS)

    if os.path.abspath(input_path) == os.path.abspath(output_path):
        raw_err = "Output would overwrite input file"
        logger.error("Job %d: output path equals input, skipping: %s", idx, input_path)
        return _job_failed_result(job_id, raw_err, max_workers=_BATCH_ACTIVE_WORKERS)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    raw_operations = job.get("operations", []) or []
    watermark = job.get("watermark")
    wm_enabled = isinstance(watermark, dict) and bool(watermark.get("enabled"))

    # Stream-copy only when there is truly nothing to composite. A watermark-only
    # job must go through the filter graph (previously watermark was skipped).
    if not raw_operations and not wm_enabled:
        logger.debug("Job %d: no operations, copying stream", idx)
        ok, err = _run_ffmpeg(
            [ffmpeg_path, "-y", "-loglevel", "error", "-i", input_path, "-c", "copy", output_path],
            timeout_sec=300
        )
        if ok:
            logger.info("Job %d: copied -> %s", idx, os.path.basename(output_path))
            _safe_print(json.dumps({"type": "complete", "index": job_id, "output": output_path}))
            return {"index": job_id, "status": "succeeded"}
        else:
            logger.error("Job %d: copy failed: %s", idx, err)
            _remove_partial_output(output_path, input_path)
            return _job_failed_result(job_id, err, max_workers=_BATCH_ACTIVE_WORKERS)

    info = job_video_info(job, input_path)
    vw = int(job.get("source_width") or job.get("width") or info.get("width") or 0)
    vh = int(job.get("source_height") or job.get("height") or info.get("height") or 0)
    duration = float(info.get("duration") or 0)
    if vw <= 0 or vh <= 0:
        ffprobe_status = f"ffprobe={FFPROBE}" if FFPROBE else "ffprobe no configurado"
        err = (
            "No se pudo leer la resolución del video: ffprobe no encontró dimensiones válidas "
            f"para '{fname}' ({ffprobe_status})."
        )
        logger.error("Job %d: invalid dimensions %dx%d for %s", idx, vw, vh, fname)
        return _job_failed_result(job_id, err, max_workers=_BATCH_ACTIVE_WORKERS)

    operations = [
        _optimize_delogo_for_speed(_normalize_operation(op), vw, vh)
        for op in raw_operations
    ]

    filter_complex, output_label, image_paths = build_filter_complex(operations, vw, vh, watermark=watermark)

    if not filter_complex and (operations or wm_enabled):
        err = (
            "Las operaciones no generaron un filtro válido. "
            "Comprueba que cada región tenga tamaño suficiente y esté dentro del video."
        )
        logger.error("Job %d: empty filter graph with %d ops", idx, len(operations))
        return _job_failed_result(job_id, err, max_workers=_BATCH_ACTIVE_WORKERS)

    src_pix_fmt = job.get("pix_fmt") or info.get("pix_fmt", "yuv420p")
    src_audio_codec = job.get("audio_codec") or info.get("audio_codec", "")
    encode_profile = job.get("encode_profile", "balanced")
    # Use the batch-level pre-flight encoder if provided; otherwise detect locally.
    if not profile_allows_hardware(encode_profile):
        local_hw_encoder = None
    elif hw_encoder is not None:
        local_hw_encoder = hw_encoder
    else:
        local_hw_encoder = detect_hw_encoder(ffmpeg_path)

    def _build_cmd(force_software=False):
        loglevel = "info" if duration > 0 else "error"
        cmd = [ffmpeg_path, "-y", "-loglevel", loglevel]
        if not force_software:
            cmd += build_hwaccel_args(local_hw_encoder, has_video_filters=bool(filter_complex))
        cmd += ["-i", input_path]
        for img_path in image_paths:
            if duration > 0:
                cmd += ["-loop", "1", "-t", f"{duration:.3f}", "-i", img_path]
            else:
                cmd += ["-loop", "1", "-i", img_path]
        if filter_complex:
            cmd += build_filter_thread_args()
            cmd += ["-filter_complex", filter_complex, "-map", output_label]
        if image_paths:
            cmd += ["-shortest"]
        cmd += build_encode_args(ffmpeg_path, encode_profile, job, force_software=force_software, hw_encoder=local_hw_encoder)
        if src_pix_fmt:
            cmd += ["-pix_fmt", src_pix_fmt]
        else:
            cmd += ["-pix_fmt", "yuv420p"]
        cmd += build_audio_args(output_path, src_audio_codec, job.get("audio_channels"))
        out_ext = os.path.splitext(output_path)[1].lower()
        if out_ext in (".mp4", ".mov", ".m4v"):
            cmd += ["-movflags", "+faststart"]
        cmd += ["-max_muxing_queue_size", "1024"]
        cmd.append(output_path)
        return cmd

    logger.info(
        "Job %d: processing '%s' [%dx%d, %d ops, profile=%s, encoder=%s]",
        idx, fname, vw, vh, len(operations), encode_profile,
        local_hw_encoder or "libx264",
    )

    # Dynamic timeout: base 5 mins + 2x video duration, min 10 mins, max 2 hours
    estimated_timeout = max(600, min(7200, int(duration * 2 + 300)))

    ok, err = _run_ffmpeg(
        _build_cmd(), timeout_sec=estimated_timeout, job_id=job_id, duration_sec=duration,
    )

    # GPU encode can fail (-22) or destabilize the display stack — retry on CPU.
    # Only attempt the fallback if the batch-level pre-flight actually found a GPU
    # encoder (local_hw_encoder is not None).  If the pre-flight was skipped, fail
    # fast so the real error is surfaced to the user instead of hiding it behind a
    # redundant software retry.
    if not ok and local_hw_encoder is not None and _is_hardware_encode_error(err):
        logger.warning("Job %d: hardware path failed, retrying with libx264", idx)
        ok, err = _run_ffmpeg(
            _build_cmd(force_software=True),
            timeout_sec=estimated_timeout,
            job_id=job_id,
            duration_sec=duration,
        )

    if ok:
        logger.info("Job %d: completed -> %s", idx, os.path.basename(output_path))
        _safe_print(json.dumps({"type": "complete", "index": job_id, "output": output_path}))
        return {"index": job_id, "status": "succeeded"}
    else:
        logger.error("Job %d: ffmpeg failed: %s", idx, err[:200] if err else "")
        _remove_partial_output(output_path, input_path)
        if err == "Cancelled":
            return _job_cancelled_result(job_id)
        return _job_failed_result(job_id, err or "Unknown error", max_workers=_BATCH_ACTIVE_WORKERS)


def _execute_batch(jobs, ffmpeg_path, max_workers, *, emit_batch_progress=True, hw_encoder=None):
    """Run one concurrent pass; returns per-job results and failure list."""
    total = len(jobs)
    results = {}
    state = {"succeeded": 0, "failed": 0, "cancelled": 0, "completed": 0}
    state_lock = threading.Lock()

    def _on_done(fut):
        try:
            result = fut.result()
        except Exception as e:
            job_pos = getattr(fut, "_beru_job_pos", -1)
            job_id = jobs[job_pos].get("id", job_pos) if 0 <= job_pos < total else -1
            result = _job_failed_result(job_id, str(e), max_workers=max_workers)

        with state_lock:
            idx = result.get("index", -1)
            results[idx] = result
            state["completed"] += 1
            status = result.get("status", "failed")
            if status == "succeeded":
                state["succeeded"] += 1
            elif status == "cancelled":
                state["cancelled"] += 1
            else:
                state["failed"] += 1

            if emit_batch_progress:
                job_pos = getattr(fut, "_beru_job_pos", -1)
                if 0 <= job_pos < total:
                    fname = os.path.basename(jobs[job_pos].get("input_path", "")) or "?"
                else:
                    fname = "?"
                progress_msg = {
                    "type": "progress",
                    "current": state["completed"],
                    "total": total,
                    "file": fname,
                    "succeeded": state["succeeded"],
                    "failed": state["failed"],
                }
                _safe_print(json.dumps(progress_msg))

    global _BATCH_ACTIVE_WORKERS
    _BATCH_ACTIVE_WORKERS = max(1, max_workers)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []
        for i, job in enumerate(jobs):
            if _check_cancelled():
                job_id = job.get("id", i) if isinstance(job, dict) else i
                with state_lock:
                    if job_id not in results:
                        results[job_id] = {"index": job_id, "status": "cancelled"}
                        state["cancelled"] += 1
                        state["completed"] += 1
                        if emit_batch_progress:
                            fname = os.path.basename(job.get("input_path", "")) if isinstance(job, dict) else "?"
                            _safe_print(json.dumps({
                                "type": "progress",
                                "current": state["completed"],
                                "total": total,
                                "file": fname,
                                "succeeded": state["succeeded"],
                                "failed": state["failed"],
                            }))
                _safe_print(json.dumps({
                    "type": "error", "index": job_id, "error": "Cancelled",
                }))
                continue
            fut = executor.submit(_process_one, i, job, ffmpeg_path, hw_encoder=hw_encoder)
            fut._beru_job_pos = i
            fut.add_done_callback(_on_done)
            futures.append(fut)
        concurrent.futures.wait(futures)

    failed_jobs = []
    for i, job in enumerate(jobs):
        if not isinstance(job, dict):
            continue
        job_id = job.get("id", i)
        result = results.get(job_id)
        if result and result.get("status") == "failed":
            failed_jobs.append((job, result))

    return {
        **state,
        "results": results,
        "failed_jobs": failed_jobs,
    }


def process_jobs(jobs, ffmpeg_path, max_workers=None, *, hw_encoder=None):
    """Process jobs concurrently. Report progress to stdout.

    Args:
        hw_encoder: If provided (from batch pre-flight), it is used directly
            for profiles that allow hardware encoding.
    """
    global _cancel_event, _jobs_file, _BATCH_ACTIVE_WORKERS
    _cancel_event.clear()
    _last_job_progress_emit.clear()

    # Warm font cache before parallel workers hit drawtext
    get_system_fonts()

    # If pre-flight hw_encoder was given, trust it; otherwise detect fresh.
    hw = hw_encoder if hw_encoder is not None else detect_hw_encoder(ffmpeg_path)
    max_pixels = 0
    has_video_filters = False
    encode_profiles = set()
    for job in jobs:
        if not isinstance(job, dict):
            continue
        w = int(job.get("source_width") or job.get("width") or 0)
        h = int(job.get("source_height") or job.get("height") or 0)
        if w > 0 and h > 0:
            max_pixels = max(max_pixels, w * h)
        if job.get("operations"):
            has_video_filters = True
        profile = (job.get("encode_profile") or "").strip().lower()
        if profile:
            encode_profiles.add(profile)

    encode_profile = (
        "uquality" if "uquality" in encode_profiles else
        "quality" if "quality" in encode_profiles else
        "balanced" if "balanced" in encode_profiles else
        "fast" if "fast" in encode_profiles else
        (os.environ.get("BERU_ENCODE_PROFILE") or "balanced")
    )
    effective_hw = resolve_effective_hw_encoder(encode_profile, hw)

    if max_workers is None:
        max_workers = resolve_max_workers(
            effective_hw,
            len(jobs),
            max_pixels,
            has_video_filters=has_video_filters,
            encode_profile=encode_profile,
        )

    total = len(jobs)
    mode = (os.environ.get("BERU_WORKERS_MODE") or "balanced").strip().lower()
    logger.info(
        "Starting batch: %d jobs, %d workers (mode=%s, encoder=%s, max_px=%d), ffmpeg=%s",
        total, max_workers, mode, effective_hw or "libx264", max_pixels, ffmpeg_path,
    )

    pass1 = _execute_batch(
        jobs,
        ffmpeg_path,
        max_workers,
        emit_batch_progress=True,
        hw_encoder=effective_hw,
    )
    succeeded = pass1["succeeded"]
    failed = pass1["failed"]
    cancelled = pass1["cancelled"]

    retry_candidates = [
        job for job, result in pass1["failed_jobs"]
        if _should_retry_failed_job(result, max_workers)
    ]
    if (
        _retry_failed_enabled()
        and max_workers > 1
        and retry_candidates
        and not _check_cancelled()
    ):
        resource_retry = any(
            _is_resource_pressure_error((result.get("raw_error") or result.get("error") or ""))
            for _job, result in pass1["failed_jobs"]
            if _should_retry_failed_job(result, max_workers)
        )
        reduced_workers = 1 if resource_retry else max(1, max_workers // 2)
        logger.info(
            "Retry pass: %d failed jobs at %d workers (was %d)",
            len(retry_candidates), reduced_workers, max_workers,
        )
        pass2 = _execute_batch(
            retry_candidates,
            ffmpeg_path,
            reduced_workers,
            emit_batch_progress=False,
            hw_encoder=effective_hw,
        )
        for job in retry_candidates:
            job_id = job.get("id")
            if job_id is None:
                continue
            prev = pass1["results"].get(job_id)
            new = pass2["results"].get(job_id)
            if not prev or prev.get("status") != "failed":
                continue
            failed -= 1
            if new and new.get("status") == "succeeded":
                succeeded += 1
            elif new and new.get("status") == "cancelled":
                cancelled += 1
            else:
                failed += 1

    logger.info("Batch finished: %d/%d succeeded, %d failed, %d cancelled",
                succeeded, total, failed, cancelled)
    return {"total": total, "succeeded": succeeded, "failed": failed, "cancelled": cancelled}


def _init_ffmpeg_globals():
    """Configure module-level FFMPEG/FFPROBE paths. Returns False if ffmpeg is missing."""
    global FFMPEG, FFPROBE

    ffmpeg_bin = find_ffmpeg()
    ffprobe_bin = find_ffprobe(ffmpeg_bin)
    if not (os.path.isfile(ffmpeg_bin) or shutil.which(ffmpeg_bin)):
        logger.error("ffmpeg not found at %s", ffmpeg_bin)
        return False

    FFMPEG = ffmpeg_bin
    FFPROBE = ffprobe_bin
    logger.info("Using ffmpeg: %s", FFMPEG)
    logger.info("Using ffprobe: %s", FFPROBE)
    return True


def render_preview_frame(payload):
    """Render one video frame with export-equivalent filters.

    Returns a dict: {ok, data_url?, error?, width?, height?, timestamp?}
    """
    try:
        payload = _validated_job_media(payload, require_output=False)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    input_path = payload.get("input_path")
    if not input_path or not os.path.exists(input_path):
        return {"ok": False, "error": f"Input not found: {input_path}"}

    try:
        timestamp = max(0.0, float(payload.get("timestamp", 0)))
    except (TypeError, ValueError):
        timestamp = 0.0

    info = job_video_info(payload, input_path)
    vw = int(payload.get("source_width") or payload.get("width") or info.get("width") or 0)
    vh = int(payload.get("source_height") or payload.get("height") or info.get("height") or 0)
    if vw <= 0 or vh <= 0:
        return {"ok": False, "error": "No se pudo leer la resolución del video"}

    raw_operations = payload.get("operations") or []
    operations = [
        _optimize_delogo_for_speed(_normalize_operation(op), vw, vh)
        for op in raw_operations
    ]
    watermark = payload.get("watermark")
    filter_complex, output_label, image_paths = build_filter_complex(
        operations, vw, vh, watermark=watermark,
    )

    # NOTE: `-ss` must come BEFORE `-i` (input seek). Placing it after `-i`
    # performs an output seek that resets the filter graph's internal `t` to 0,
    # so `enable=between(t,start,end)` clauses evaluate against t=0 regardless
    # of the requested timestamp — time-bounded ops appear inactive in preview
    # while export applies them at the correct t. Input seek preserves the
    # original timeline so the filter graph sees the same `t` as export.
    cmd = [
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{timestamp:.3f}",
        "-i", input_path,
    ]
    for img_path in image_paths:
        cmd += ["-loop", "1", "-i", img_path]
    if filter_complex:
        cmd += ["-filter_complex", filter_complex, "-map", output_label]
    else:
        cmd += ["-map", "0:v:0"]
    cmd += ["-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"]

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=45)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Timeout al renderizar el frame"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    if result.returncode != 0:
        err = (result.stderr or b"").decode("utf-8", errors="replace").strip()
        return {"ok": False, "error": err or f"FFmpeg exited with code {result.returncode}"}

    buf = result.stdout or b""
    if len(buf) < 64:
        return {"ok": False, "error": "FFmpeg no produjo imagen"}

    data_url = "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")
    return {
        "ok": True,
        "data_url": data_url,
        "width": vw,
        "height": vh,
        "timestamp": timestamp,
    }


def preview_frame_main(json_path):
    if not _init_ffmpeg_globals():
        print(json.dumps({"ok": False, "error": "ffmpeg not found"}))
        sys.exit(1)

    with open(json_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    get_system_fonts()
    result = render_preview_frame(payload)
    print(json.dumps(result))
    sys.exit(0 if result.get("ok") else 1)


def preview_frame_worker_main():
    """Serve preview requests as newline-delimited JSON over stdin/stdout."""
    if not _init_ffmpeg_globals():
        print(json.dumps({"type": "ready", "ok": False, "error": "ffmpeg not found"}), flush=True)
        return

    get_system_fonts()
    print(json.dumps({"type": "ready", "ok": True}), flush=True)

    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            payload = request.get("payload")
            if not isinstance(request_id, int) or not isinstance(payload, dict):
                raise ValueError("Invalid preview request")
            result = render_preview_frame(payload)
        except Exception as exc:
            result = {"ok": False, "error": str(exc)}

        print(json.dumps({"id": request_id, **result}), flush=True)


def main():
    global FFMPEG, FFPROBE, _jobs_file

    if len(sys.argv) >= 2 and sys.argv[1] == "--preview-frame-worker":
        preview_frame_worker_main()
        return

    if len(sys.argv) >= 3 and sys.argv[1] == "--preview-frame":
        preview_frame_main(sys.argv[2])
        return

    if len(sys.argv) < 2:
        logger.error("Missing jobs.json argument")
        print(json.dumps({"type": "error", "error": "Usage: processor.py <jobs.json>"}))
        sys.exit(1)

    _jobs_file = sys.argv[1]

    if not _init_ffmpeg_globals():
        print(json.dumps({"type": "error", "error": f"ffmpeg not found at {find_ffmpeg()}"}))
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        payload = json.load(f)

    if isinstance(payload, list):
        jobs = payload
    elif isinstance(payload, dict):
        manifest_type = payload.get("type")
        manifest_version = payload.get("version")
        if manifest_type != JOB_MANIFEST_TYPE:
            logger.error("Invalid jobs manifest type: %s", manifest_type)
            print(json.dumps({"type": "error", "error": "Invalid jobs manifest type"}))
            sys.exit(1)
        if manifest_version != JOB_MANIFEST_VERSION:
            logger.error("Unsupported jobs manifest version: %s", manifest_version)
            print(json.dumps({"type": "error", "error": "Unsupported jobs manifest version"}))
            sys.exit(1)
        if not isinstance(payload.get("jobs"), list):
            logger.error("Invalid jobs manifest: jobs must be an array")
            print(json.dumps({"type": "error", "error": "Invalid jobs manifest"}))
            sys.exit(1)
        jobs = payload["jobs"]
    else:
        logger.error("Invalid jobs file: expected array or {jobs:[]}")
        print(json.dumps({"type": "error", "error": "Invalid jobs manifest"}))
        sys.exit(1)

    get_system_fonts()

    # Pre-flight hardware validation: detect and test the encoder before committing
    # workers. If a 1-frame smoke test fails, force software for the whole batch.
    preflight_hw = detect_hw_encoder(FFMPEG, force_test=True)
    if preflight_hw is None:
        logger.info("Hardware encoder pre-flight failed; using software (libx264) for batch")

    result = process_jobs(jobs, FFMPEG, hw_encoder=preflight_hw)
    print(json.dumps({"type": "summary", **result}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logging.getLogger("beru").exception("Fatal processor error")
        print(json.dumps({"type": "error", "error": str(exc)}))
        sys.exit(1)
