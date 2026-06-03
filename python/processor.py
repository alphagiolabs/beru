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
from pathlib import Path

FFMPEG = os.environ.get("BERU_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("BERU_FFPROBE", "ffprobe")

FONT_DIRS = []


def _init_font_dirs():
    global FONT_DIRS
    system = platform.system()
    if system == "Windows":
        FONT_DIRS = [
            Path("C:/Windows/Fonts"),
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
    _SYSTEM_FONTS_CACHE = fonts
    return fonts


def _resolve_font(font_family):
    """Resolve a font family name to a fontfile path or fallback name.
    Returns (option_key, value, is_fontfile) where option_key is 'fontfile' or 'font'."""
    fonts = get_system_fonts()
    key = font_family.lower()
    if key in fonts:
        full_path, _stem = fonts[key]
        return "fontfile", full_path.replace("\\", "/").replace(":", "\\:"), True
    # Try partial match
    for fkey, (fpath, fstem) in fonts.items():
        if key in fkey or fkey in key:
            return "fontfile", fpath.replace("\\", "/").replace(":", "\\:"), True
    # Fallback: let FFmpeg try fontconfig / system lookup
    return "font", font_family, False


def setup_logging():
    """Configure structured logging to rotating file and stderr."""
    log_dir = Path(os.environ.get("BERU_LOG_DIR", Path.home() / ".beru" / "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("beru")
    logger.setLevel(logging.DEBUG)

    fh = logging.handlers.RotatingFileHandler(
        log_dir / "processor.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8"
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(fh)

    sh = logging.StreamHandler(sys.stderr)
    sh.setLevel(logging.INFO)
    sh.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    logger.addHandler(sh)

    return logger


logger = setup_logging()

# Encode profiles: fast (batch throughput), balanced (default), quality (max fidelity)
ENCODE_PROFILES = {
    "fast": {"crf": 26, "preset": "ultrafast", "hw_cq": 28, "nvenc_preset": "p1"},
    "balanced": {"crf": 23, "preset": "fast", "hw_cq": 23, "nvenc_preset": "p4"},
    "quality": {"crf": 18, "preset": "medium", "hw_cq": 18, "nvenc_preset": "p6"},
}

# Audio codecs that can be stream-copied into each container (no re-encode).
_AUDIO_COPY_CODECS = {
    ".mp4": frozenset({"aac", "mp3", "mp4a"}),
    ".mov": frozenset({"aac", "mp3", "alac"}),
    ".m4v": frozenset({"aac"}),
    ".mkv": frozenset({"aac", "mp3", "opus", "flac", "vorbis", "eac3", "ac3"}),
    ".avi": frozenset({"mp3", "ac3", "pcm_s16le", "pcm_s24le"}),
}

_HW_ENCODER_CACHE = None


def detect_hw_encoder(ffmpeg_path):
    """Detect first usable hardware H.264 encoder. Cached for process lifetime."""
    global _HW_ENCODER_CACHE
    if _HW_ENCODER_CACHE is not None:
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

    for enc in priority:
        if enc in encoders_text:
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
_BATCH_ACTIVE_WORKERS = 1


def build_filter_thread_args(active_workers=None):
    """Parallelize filter graph; fewer threads per job when many jobs run at once."""
    workers = active_workers if active_workers is not None else _BATCH_ACTIVE_WORKERS
    cpus = os.cpu_count() or 4
    n = max(1, min(4, cpus // max(1, int(workers))))
    return ["-filter_threads", str(n), "-filter_complex_threads", str(n)]


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


def build_encode_args(ffmpeg_path, profile_name, job, force_software=False):
    """Return ffmpeg video encode argument list for the given profile."""
    profile = ENCODE_PROFILES.get(profile_name, ENCODE_PROFILES["balanced"])
    use_hw = not force_software and profile.get("hw_cq") is not None
    hw = detect_hw_encoder(ffmpeg_path) if use_hw else None

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
        quality = "speed" if profile_name == "fast" else "balanced"
        return ["-c:v", "h264_amf", "-quality", quality]

    if hw == "h264_videotoolbox":
        q = max(1, min(100, 100 - (profile.get("hw_cq") or 23) * 2))
        return ["-c:v", "h264_videotoolbox", "-q:v", str(q)]

    if hw == "h264_vaapi":
        qp = profile.get("hw_cq", 23)
        return ["-c:v", "h264_vaapi", "-qp", str(qp)]

    # Software fallback (libx264)
    preset = job.get("speed_preset") or profile["preset"]
    return [
        "-c:v", "libx264",
        "-crf", str(profile["crf"]),
        "-preset", preset,
        "-threads", "0",
    ]


def resolve_max_workers(hw_encoder, job_count, max_source_pixels=0):
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

    if hw_encoder:
        cap = caps.get(hw_encoder, caps.get("h264_nvenc", 2))
        workers = max(1, min(cap, job_count))
        if (
            mode == "balanced"
            and hw_encoder != "h264_mf"
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

    return workers


def job_video_info(job, input_path):
    """Use metadata from the job when Electron already probed the file."""
    jw = int(job.get("source_width") or job.get("width") or 0)
    jh = int(job.get("source_height") or job.get("height") or 0)
    if jw > 0 and jh > 0:
        return {
            "width": jw,
            "height": jh,
            "duration": float(job.get("video_duration") or 0),
            "pix_fmt": job.get("pix_fmt") or "yuv420p",
            "frame_rate": float(job.get("frame_rate") or 0),
            "audio_codec": job.get("audio_codec") or "",
            "audio_channels": int(job.get("audio_channels") or 0),
            "video_codec": job.get("video_codec") or "",
        }
    return ffprobe(input_path)


def find_ffmpeg():
    """Locate ffmpeg binary - bundled, env var, or system PATH."""
    env_ffmpeg = os.environ.get("BERU_FFMPEG")
    if env_ffmpeg and os.path.isfile(env_ffmpeg):
        return env_ffmpeg

    script_dir = Path(__file__).resolve().parent  # python/
    project_root = script_dir.parent               # beru/
    resources_root = script_dir.parent             # resources/ (when packaged: resources/python/processor.py)

    candidates = [
        project_root / "src-tauri" / "bin" / "ffmpeg.exe",   # dev: beru/src-tauri/bin
        project_root / "bin" / "ffmpeg.exe",                  # dev fallback
        resources_root / "bin" / "ffmpeg.exe",                # packaged: resources/bin/ (python is resources/python/)
    ]
    for c in candidates:
        if c.exists():
            return str(c)

    found = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
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
    candidates = [
        Path(ffmpeg_bin).with_name("ffprobe.exe"),
        Path(ffmpeg_bin).parent / "ffprobe.exe",
        project_root / "src-tauri" / "bin" / "ffprobe.exe",
        project_root / "bin" / "ffprobe.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    found = shutil.which("ffprobe") or shutil.which("ffprobe.exe")
    if found:
        return found
    return ffmpeg_bin.replace("ffmpeg.exe", "ffprobe.exe").replace("ffmpeg", "ffprobe")


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
        video_line = ""
        for line in text.splitlines():
            if re.search(r"\bVideo:\s*", line, re.I):
                video_line = line
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
        audio_line = next((ln for ln in text.splitlines() if re.search(r"\bAudio:\s*", ln, re.I)), "")
        audio_match = re.search(r"Audio:\s*([^,\s(]+)", audio_line, re.I)
        fps_match = re.search(r",\s*([0-9]+(?:\.[0-9]+)?)\s*fps\b", video_line or text, re.I)
        return {
            "width": width,
            "height": height,
            "duration": duration,
            "video_codec": codec_match.group(1) if codec_match else "",
            "pix_fmt": "yuv420p",
            "frame_rate": float(fps_match.group(1)) if fps_match else 0.0,
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
            "width": video_stream.get("width", 0),
            "height": video_stream.get("height", 0),
            "duration": float(fmt.get("duration", 0)),
            "video_codec": video_stream.get("codec_name", ""),
            "pix_fmt": video_stream.get("pix_fmt", "yuv420p"),
            "bit_rate": int(fmt.get("bit_rate", 0)) or int(video_stream.get("bit_rate", 0)),
            "frame_rate": _parse_frame_rate(video_stream.get("r_frame_rate") or video_stream.get("avg_frame_rate", "")),
            "audio_codec": audio_stream.get("codec_name", "") if audio_stream else "",
            "audio_channels": int(audio_stream.get("channels", 0)) if audio_stream else 0,
        }
    except Exception as e:
        logger.warning("ffprobe failed for %s: %s", os.path.basename(path), e)
    return _ffprobe_via_ffmpeg(path)


def build_drawtext(op):
    """Build ffmpeg drawtext filter string from operation."""
    text = (op.get("text") or "").strip()
    if not text:
        return None

    # Escape the text for FFmpeg drawtext syntax
    text = (text
            .replace("\\", "\\\\")
            .replace(":", "\\:")
            .replace("'", "\\'")
            .replace("=", "\\=")
            .replace(";", "\\;")
            .replace(",", "\\,")
            .replace("%", "\\%")
            .replace("{", "\\{")
            .replace("}", "\\}")
            .replace("\n", "\\n")
            .replace("\r", ""))

    font_size = op.get("font_size", 32)
    font_color = op.get("font_color", "white")
    font_family = op.get("font_family", "Arial")
    bold = 1 if op.get("bold") else 0
    italic = 1 if op.get("italic") else 0
    region = op.get("region", {})
    x = int(region.get("x", 0))
    y = int(region.get("y", 0))
    
    # 3. Dynamic text alignment using FFmpeg's native text_w variable
    text_align = op.get("text_align", "left")
    region_w = region.get("w", 0)
    
    if text_align == "center" and region_w > 0:
        x_expr = f"{x} + ({region_w} - text_w) / 2"
    elif text_align == "right" and region_w > 0:
        x_expr = f"{x} + {region_w} - text_w"
    else:
        x_expr = str(x)

    font_key, font_val, is_fontfile = _resolve_font(font_family)
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
        f"y={y}",
    ]

    # Numeric font weight (100-900). "bold" is a convenience alias.
    font_weight = op.get("font_weight")
    if font_weight is None and bold:
        font_weight = 700
    if font_weight is not None:
        try:
            fw = int(font_weight)
            if 100 <= fw <= 1000:
                parts.append(f"fontweight={fw}")
        except (TypeError, ValueError):
            pass

    if italic:
        parts.append("fontstyle=italic")

    # Letter spacing (drawtext spacing= pixels between glyphs; matches CSS preview)
    letter_spacing = op.get("letter_spacing", 0)
    try:
        spacing_px = int(round(float(letter_spacing)))
    except (TypeError, ValueError):
        spacing_px = 0
    if spacing_px > 0:
        parts.append(f"spacing={spacing_px}")

    # Background box
    if op.get("bg_enabled", True):
        bg_color = op.get("bg_color", "black")
        bg_opacity = op.get("bg_opacity", 0.65)
        try:
            box_pad = int(op.get("box_border_width", 4))
        except (TypeError, ValueError):
            box_pad = 4
        box_pad = max(0, box_pad)
        parts.append(f"box=1:boxcolor={bg_color}@{bg_opacity}:boxborderw={box_pad}")

    # Border/stroke
    border_w = op.get("border_width", 0)
    if border_w > 0:
        border_color = op.get("border_color", "black")
        parts.append(f"bordercolor={border_color}:borderw={border_w}")

    # Time range (enable clause)
    enable_clause = _build_enable_clause(op)
    if enable_clause:
        parts.append(enable_clause)

    filter_str = "drawtext=" + ":".join(parts)
    logger.debug("drawtext filter: %s", filter_str[:300])
    return filter_str


def _build_enable_clause(op):
    """Build an `enable=...` clause for time-bounding filters.

    Returns "" if no time range, else a clause like:
        enable=between(t\\,0.500000\\,2.000000)
    Note: literal commas are escaped (\\,) so they don't split filter options.
    """
    start = op.get("start_time", op.get("startTime"))
    end = op.get("end_time", op.get("endTime"))
    if start is None and end is None:
        return ""
    s = float(start) if start is not None else 0.0
    e = float(end) if end is not None else 0.0
    if e <= s:
        return ""
    return f"enable=between(t\\,{s:.6f}\\,{e:.6f})"


VALID_DELOGO_METHODS = frozenset({
    "temporal", "mirror", "mosaic", "inpaint", "blur", "fill",
})


def _coerce_int(val, default, lo, hi):
    if val is None:
        v = default
    else:
        try:
            v = int(val)
        except (TypeError, ValueError):
            v = default
    return max(lo, min(hi, v))


def _normalize_operation(op):
    """Accept snake_case or camelCase keys from jobs / hand-edited JSON."""
    if not isinstance(op, dict):
        return op
    out = dict(op)
    mode = (out.get("mode") or "").lower()
    if mode != "delogo":
        return out

    method = out.get("delogo_method") or out.get("delogoMethod") or "temporal"
    method = str(method).lower()
    out["delogo_method"] = method if method in VALID_DELOGO_METHODS else "temporal"

    pairs = (
        ("temporal_radius", "temporalRadius"),
        ("mosaic_size", "mosaicSize"),
        ("mirror_side", "mirrorSide"),
        ("edge_feather", "edgeFeather"),
        ("blur_strength", "blurStrength"),
        ("delogo_fill_color", "delogoFillColor"),
        ("delogo_fill_opacity", "delogoFillOpacity"),
        ("start_time", "startTime"),
        ("end_time", "endTime"),
    )
    for snake, camel in pairs:
        if out.get(snake) is None and camel in out:
            out[snake] = out[camel]

    return out


def _optimize_delogo_for_speed(op, video_w, video_h):
    """Use inpaint instead of tmedian for full-duration static logos (much faster)."""
    if (op.get("mode") or "").lower() != "delogo":
        return op
    method = (op.get("delogo_method") or "temporal").lower()
    if method != "temporal":
        return op

    start = op.get("start_time", op.get("startTime"))
    end = op.get("end_time", op.get("endTime"))
    if start is not None or end is not None:
        return op

    radius = op.get("temporal_radius")
    if radius is not None:
        try:
            if int(radius) != 3:
                return op
        except (TypeError, ValueError):
            pass

    region = op.get("region") or {}
    rw = float(region.get("w", 0))
    rh = float(region.get("h", 0))
    if rw <= 0 or rh <= 0:
        return op

    if video_w > 0 and video_h > 0 and rw <= 1 and rh <= 1:
        area_ratio = rw * rh
    elif video_w > 0 and video_h > 0:
        area_ratio = (rw * rh) / (video_w * video_h)
    else:
        area_ratio = 0.1

    if area_ratio > 0.25:
        return op

    optimized = dict(op)
    optimized["delogo_method"] = "inpaint"
    logger.debug(
        "delogo: temporal -> inpaint (%.1f%% frame, faster static path)", area_ratio * 100
    )
    return optimized


def _fit_delogo_rect(x, y, w, h, video_w, video_h):
    """Clamp logo box to frame; FFmpeg delogo prefers even width/height."""
    x = max(0, min(int(x), max(0, video_w - 2)))
    y = max(0, min(int(y), max(0, video_h - 2)))
    w = max(2, min(int(w), video_w - x))
    h = max(2, min(int(h), video_h - y))
    if w % 2:
        w -= 1
    if h % 2:
        h -= 1
    if w < 2:
        w = 2
    if h < 2:
        h = 2
    if x + w > video_w:
        x = max(0, video_w - w)
    if y + h > video_h:
        y = max(0, video_h - h)
    return x, y, w, h


def _build_padded_region(x, y, w, h, video_w, video_h, pad):
    """Return (x0, y0, rw, rh) for a feather/context pad around the logo box."""
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(video_w, x + w + pad)
    y1 = min(video_h, y + h + pad)
    rw = x1 - x0
    rh = y1 - y0
    if rw <= 0 or rh <= 0:
        return None
    return x0, y0, rw, rh


def _build_cleanup_filter(method, op, rw, rh):
    """Single-input cleanup filters for a cropped patch (rw x rh).

    Mirror and inpaint are handled separately on the full frame.
    """
    if method == "temporal":
        radius = _coerce_int(op.get("temporal_radius"), 3, 1, 15)
        # Median across neighboring frames removes static logos on motion.
        return f"tmedian=radius={radius}:planes=0x7"

    if method == "mosaic":
        block = _coerce_int(op.get("mosaic_size"), 12, 2, 80)
        return (
            f"scale=iw/{block}:ih/{block}:flags=neighbor,"
            f"scale={rw}:{rh}:flags=neighbor"
        )

    if method == "blur":
        strength = _coerce_int(op.get("blur_strength"), 20, 1, 100)
        luma = max(1, min(100, strength // 3))
        chroma = max(1, luma // 2)
        return f"boxblur=luma_radius={luma}:luma_power=1:chroma_radius={chroma}:chroma_power=1"

    if method == "fill":
        fill_color = op.get("delogo_fill_color", "black") or "black"
        fill_opacity = float(op.get("delogo_fill_opacity", 1) or 1)
        return (
            f"drawbox=x=0:y=0:w={rw}:h={rh}:color={fill_color}@{fill_opacity}:t=fill"
        )

    # inpaint / mirror use dedicated paths; fallback = edge blend
    return "boxblur=luma_radius=10:luma_power=1:chroma_radius=5:chroma_power=1"


def _build_mirror_patch(side, x, y, w, h, video_w, video_h, in_label, out_label):
    """Sample pixels adjacent to the logo box and mirror them into the patch.

    Matches the live-preview logic: reflect the strip beside the selection
    over the logo area (same approach as online logo removers on uniform bg).
    """
    side = (side or "right").lower()
    in_pad = f"[{in_label}]"
    out_pad = f"[{out_label}]"

    if side == "right":
        if x + w + w <= video_w:
            return f"{in_pad}crop={w}:{h}:{x + w}:{y},hflip{out_pad}"
        if x >= w:
            return f"{in_pad}crop={w}:{h}:{x - w}:{y},hflip{out_pad}"
    elif side == "left":
        if x >= w:
            return f"{in_pad}crop={w}:{h}:{x - w}:{y},hflip{out_pad}"
        if x + w + w <= video_w:
            return f"{in_pad}crop={w}:{h}:{x + w}:{y},hflip{out_pad}"
    elif side == "bottom":
        if y + h + h <= video_h:
            return f"{in_pad}crop={w}:{h}:{x}:{y + h},vflip{out_pad}"
        if y >= h:
            return f"{in_pad}crop={w}:{h}:{x}:{y - h},vflip{out_pad}"
    elif side == "top":
        if y >= h:
            return f"{in_pad}crop={w}:{h}:{x}:{y - h},vflip{out_pad}"
        if y + h + h <= video_h:
            return f"{in_pad}crop={w}:{h}:{x}:{y + h},vflip{out_pad}"

    # Partial strip at frame edge: use whatever context exists, then scale.
    if side in ("left", "right"):
        avail = video_w - (x + w) if side == "right" else x
        src_x = x + w if side == "right" else max(0, x - avail)
        cw = max(1, min(w, avail if avail > 0 else w))
        return (
            f"{in_pad}crop={cw}:{h}:{src_x}:{y},hflip,"
            f"scale={w}:{h}:flags=bilinear{out_pad}"
        )
    avail = video_h - (y + h) if side == "bottom" else y
    src_y = y + h if side == "bottom" else max(0, y - avail)
    ch = max(1, min(h, avail if avail > 0 else h))
    return (
        f"{in_pad}crop={w}:{ch}:{x}:{src_y},vflip,"
        f"scale={w}:{h}:flags=bilinear{out_pad}"
    )


def _overlay_opts(x, y, enable_clause):
    opts = f"{x}:{y}"
    if enable_clause:
        opts += f":{enable_clause}"
    return opts


def _build_delogo_chain(op, prev_label, idx, video_w, video_h):
    """Build delogo filter chain (split → clean → overlay).

    - temporal / mosaic / blur / fill: clean the (optionally padded) crop.
    - inpaint: FFmpeg delogo on full frame (interpolates from edges).
    - mirror: reflect adjacent pixels into the logo box (uniform backgrounds).
    """
    region = op.get("region") or {}
    x = int(region.get("x", 0))
    y = int(region.get("y", 0))
    w = int(region.get("w", video_w))
    h = int(region.get("h", video_h))
    if w <= 0 or h <= 0:
        return None

    x, y, w, h = _fit_delogo_rect(x, y, w, h, video_w, video_h)

    method = (op.get("delogo_method") or "temporal").lower()
    if method not in VALID_DELOGO_METHODS:
        method = "temporal"
    raw_feather = op.get("edge_feather")
    feather = max(0, min(40, int(raw_feather if raw_feather is not None else 6)))
    pad = max(2, feather)
    padded = _build_padded_region(x, y, w, h, video_w, video_h, pad)
    if padded is None:
        return None
    x0, y0, rw, rh = padded

    enable_clause = _build_enable_clause(op)
    src = "[0:v]" if prev_label is None else f"[{prev_label}]"
    s = f"d{idx}"
    feather_blur = max(1, feather)

    # ── Inpaint: native delogo on full frame (best for watermark boxes) ──
    if method == "inpaint":
        delogo = f"delogo=x={x}:y={y}:w={w}:h={h}"
        if feather <= 0 and not enable_clause:
            return f"{src}{delogo}[tmp{idx}]"
        return (
            f"{src}split[full{s}][work{s}];"
            f"[work{s}]{delogo}[work_clean{s}];"
            f"[work_clean{s}]crop={rw}:{rh}:{x0}:{y0}[crop{s}];"
            f"[crop{s}]boxblur={feather_blur}[soft{s}];"
            f"[full{s}][soft{s}]overlay={_overlay_opts(x0, y0, enable_clause)}[tmp{idx}]"
        )

    # ── Mirror: sample from outside the logo, overlay at logo coords ──
    if method == "mirror":
        mirror_side = op.get("mirror_side") or "right"
        mirror_chain = _build_mirror_patch(
            mirror_side, x, y, w, h, video_w, video_h, f"work{s}", f"clean{s}"
        )
        if feather <= 0:
            return (
                f"{src}split[full{s}][work{s}];"
                f"{mirror_chain};"
                f"[full{s}][clean{s}]overlay={_overlay_opts(x, y, enable_clause)}[tmp{idx}]"
            )
        return (
            f"{src}split[full{s}][work{s}];"
            f"{mirror_chain};"
            f"[clean{s}]boxblur={feather_blur}[soft{s}];"
            f"[full{s}][soft{s}]overlay={_overlay_opts(x, y, enable_clause)}[tmp{idx}]"
        )

    # ── Patch methods: crop → clean → (feather) → overlay ──
    cleanup = _build_cleanup_filter(method, op, rw, rh)

    if feather <= 0:
        return (
            f"{src}split[full{s}][work{s}];"
            f"[work{s}]crop={w}:{h}:{x}:{y}[crop{s}];"
            f"[crop{s}]{cleanup}[clean{s}];"
            f"[full{s}][clean{s}]overlay={_overlay_opts(x, y, enable_clause)}[tmp{idx}]"
        )

    return (
        f"{src}split[full{s}][work{s}];"
        f"[work{s}]crop={rw}:{rh}:{x0}:{y0}[crop{s}];"
        f"[crop{s}]{cleanup}[clean{s}];"
        f"[clean{s}]boxblur={feather_blur}[soft{s}];"
        f"[full{s}][soft{s}]overlay={_overlay_opts(x0, y0, enable_clause)}[tmp{idx}]"
    )


def _region_to_pixels(region, video_w, video_h):
    """Convert a normalized (0..1) or pixel region to integer pixel coords."""
    if not region:
        return None
    x = float(region.get("x", 0))
    y = float(region.get("y", 0))
    w = float(region.get("w", 0))
    h = float(region.get("h", 0))
    if w <= 0 or h <= 0:
        return None
    if video_w > 0 and video_h > 0 and x <= 1 and y <= 1 and w <= 1 and h <= 1:
        px = max(0, int(round(x * video_w)))
        py = max(0, int(round(y * video_h)))
        pw = max(1, min(video_w - px, int(round(w * video_w))))
        ph = max(1, min(video_h - py, int(round(h * video_h))))
        return {"x": px, "y": py, "w": pw, "h": ph}
    px = max(0, int(x))
    py = max(0, int(y))
    pw = max(1, min(video_w - px, int(w))) if video_w > 0 else max(1, int(w))
    ph = max(1, min(video_h - py, int(h))) if video_h > 0 else max(1, int(h))
    return {"x": px, "y": py, "w": pw, "h": ph}


def build_filter_complex(operations, video_w, video_h):
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
            dt = build_drawtext(op)
            if not dt:
                continue
            if n == 0:
                filters.append(f"[0:v]{dt}[tmp{n}]")
            else:
                filters.append(f"[tmp{n-1}]{dt}[tmp{n}]")
        elif mode == "blur":
            strength = op.get("blur_strength", 20)
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
                # Time-bounded crop: overlay cropped region on original during time range
                overlay_opts = f"0:0:{enable_clause}"
                if n == 0:
                    filters.append(
                        f"[0:v]split[full{n}][crop_in{n}];"
                        f"[crop_in{n}]crop={w}:{h}:{x}:{y},scale={w}:{h}[cropped{n}];"
                        f"[full{n}][cropped{n}]overlay={overlay_opts}[tmp{n}]"
                    )
                else:
                    filters.append(
                        f"[tmp{n-1}]split[full{n}][crop_in{n}];"
                        f"[crop_in{n}]crop={w}:{h}:{x}:{y},scale={w}:{h}[cropped{n}];"
                        f"[full{n}][cropped{n}]overlay={overlay_opts}[tmp{n}]"
                    )
            else:
                # Full-duration crop: changes output resolution
                if n == 0:
                    filters.append(f"[0:v]crop={w}:{h}:{x}:{y}[tmp{n}]")
                else:
                    filters.append(f"[tmp{n-1}]crop={w}:{h}:{x}:{y}[tmp{n}]")
        elif mode == "delogo":
            prev = f"tmp{n-1}" if n > 0 else None
            chain = _build_delogo_chain({**op, "region": region}, prev, n, video_w, video_h)
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
            opacity = float(op.get("image_opacity", 1) or 1)
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

    if n == 0:
        return None, None, []

    return ";".join(filters), f"[tmp{n - 1}]", image_paths


def _crop_changes_output_size(operations):
    """True when a full-duration crop op changes the export canvas size."""
    for raw_op in operations:
        op = _normalize_operation(raw_op)
        if op.get("mode") != "crop":
            continue
        if _build_enable_clause(op):
            continue
        return True
    return False


def _ensure_output_dimensions(filter_complex, output_label, target_w, target_h):
    """Force final frame size to match resolution locked at import.

    Called only when no full-duration crop is present. In that case the
    filter chain's default output is the source resolution (vw x vh), which
    equals the target. Appending `scale` would be a no-op that still
    allocates buffers and runs a lanczos resample, so skip it.

    If a future op changes the main video frame size before the output
    label, this function should be revisited.
    """
    if not filter_complex or target_w <= 0 or target_h <= 0:
        return filter_complex, output_label
    return filter_complex, output_label


MAX_RETRIES = 2
RETRY_DELAYS = [2, 5]
MAX_STDERR_LINES = 256
MAX_STDERR_CHARS = 48_000
_tr_print_lock = threading.Lock()
_last_job_progress_emit = {}
_job_progress_lock = threading.Lock()
_cancel_event = threading.Event()
_jobs_file = None


def _safe_print(msg):
    """Thread-safe JSON print to stdout."""
    with _tr_print_lock:
        print(msg, flush=True)


def _check_cancelled():
    """Check if cancellation was requested via sentinel file or event."""
    if _cancel_event.is_set():
        return True
    if _jobs_file:
        cancel_file = _jobs_file.replace(".json", ".cancel")
        if os.path.exists(cancel_file):
            _cancel_event.set()
            return True
    return False


def _is_transient_error(stderr_text):
    """Heuristic: detect transient FFmpeg errors that warrant a retry."""
    markers = [
        "i/o error", "no space left", "permission denied",
        "temporary failure", "resource temporarily unavailable",
        "connection reset", "broken pipe",
    ]
    lower = stderr_text.lower()
    return any(m in lower for m in markers)


def _is_hardware_encode_error(stderr_text):
    """Detect hardware encoder failures, including generic filter-layer errors."""
    if not stderr_text:
        return False
    lower = stderr_text.lower()
    markers = [
        "nvenc",
        "amf",
        "qsv",
        "videotoolbox",
        "hwaccel",
        "error code: -22",
        "operation not permitted",
        "error while filtering",
    ]
    return any(m in lower for m in markers)


def _stderr_buffer_append(buffer, line):
    """Keep stderr bounded while streaming FFmpeg output."""
    buffer.append(line)
    while len(buffer) > MAX_STDERR_LINES:
        buffer.pop(0)
    joined = "".join(buffer)
    while len(joined) > MAX_STDERR_CHARS and buffer:
        buffer.pop(0)
        joined = "".join(buffer)


def _retry_failed_enabled():
    flag = (os.environ.get("BERU_RETRY_FAILED") or "1").strip().lower()
    return flag not in ("0", "false", "no", "off")


def _is_hw_encoder_error(err_text):
    """Errors that often clear when fewer parallel GPU encodes run."""
    if not err_text:
        return False
    lower = err_text.lower()
    markers = (
        "nvenc", "amf", "qsv", "videotoolbox", "vaapi", "h264_mf",
        "error code: -22", "hwaccel", "no capable devices",
        "cannot create cuda", "out of memory", "encoder init",
    )
    return any(m in lower for m in markers)


def _should_retry_failed_job(result, max_workers):
    if result.get("status") != "failed":
        return False
    err = result.get("error") or ""
    if _is_hw_encoder_error(err):
        return True
    if max_workers >= 3 and "timeout" in err.lower():
        return True
    return False


def _extract_error_line(stderr_text):
    """Extract the most relevant error line from FFmpeg stderr."""
    if len(stderr_text) > MAX_STDERR_CHARS:
        stderr_text = stderr_text[-MAX_STDERR_CHARS:]
    lines = stderr_text.split("\n")
    for line in reversed(lines):
        stripped = line.strip()
        if stripped and "error" in stripped.lower():
            return stripped[-400:]
    if len(lines) > 1:
        return lines[-2].strip()[-400:]
    return stderr_text.strip()[-400:]


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


def _run_ffmpeg(cmd, timeout_sec=600, job_id=None, duration_sec=0.0):
    """Run ffmpeg with retry for transient failures."""
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            logger.debug("FFmpeg cmd: %s", " ".join(str(x) for x in cmd)[:500])
            t0 = time.perf_counter()
            if job_id is not None and duration_sec > 0:
                ok, err = _run_ffmpeg_with_progress(
                    cmd, timeout_sec, job_id, duration_sec
                )
            else:
                proc = subprocess.run(cmd, capture_output=True, timeout=timeout_sec)
                ok = proc.returncode == 0
                stderr_raw = proc.stderr.decode("utf-8", errors="replace")
                if len(stderr_raw) > MAX_STDERR_CHARS:
                    stderr_raw = stderr_raw[-MAX_STDERR_CHARS:]
                err = None if ok else _extract_error_line(stderr_raw)
            elapsed = time.perf_counter() - t0
            if ok:
                logger.info("FFmpeg finished in %.1fs (job=%s)", elapsed, job_id)
                return True, None
            stderr = err or ""
            if _is_transient_error(stderr) and attempt < MAX_RETRIES:
                logger.warning("Transient error, retry %d/%d: %s",
                               attempt + 1, MAX_RETRIES, (stderr or "")[:150])
                time.sleep(RETRY_DELAYS[attempt])
                continue
            return False, stderr if stderr else "Unknown error"
        except subprocess.TimeoutExpired:
            if attempt < MAX_RETRIES:
                logger.warning("Timeout, retry %d/%d", attempt + 1, MAX_RETRIES)
                time.sleep(RETRY_DELAYS[attempt])
                continue
            return False, f"Timeout after {timeout_sec}s"
        except Exception as e:
            if attempt < MAX_RETRIES:
                logger.warning("Exception, retry %d/%d: %s", attempt + 1, MAX_RETRIES, e)
                time.sleep(RETRY_DELAYS[attempt])
                continue
            return False, str(e)
    return False, str(last_error) if last_error else "Unknown error"


def _run_ffmpeg_with_progress(cmd, timeout_sec, job_id, duration_sec):
    """Run ffmpeg and parse stderr time= for per-job progress."""
    time_re = re.compile(r"time=(\d+):(\d+):(\d+\.?\d*)")
    speed_re = re.compile(r"speed=\s*([0-9.]+)x")
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    stderr_lines = []
    last_pct = -1.0
    try:
        for line in proc.stderr:
            _stderr_buffer_append(stderr_lines, line)
            if _check_cancelled():
                proc.kill()
                proc.wait(timeout=5)
                return False, "Cancelled"
            m = time_re.search(line)
            if not m:
                continue
            h, mi, sec = int(m.group(1)), int(m.group(2)), float(m.group(3))
            cur = h * 3600 + mi * 60 + sec
            pct = (cur / duration_sec) * 100.0 if duration_sec > 0 else 0.0
            sm = speed_re.search(line)
            speed = float(sm.group(1)) if sm else None
            if pct - last_pct >= 1.0 or pct >= 99.0:
                _emit_job_progress(job_id, pct, speed)
                last_pct = pct
        proc.wait(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
        return False, f"Timeout after {timeout_sec}s"
    stderr = "".join(stderr_lines)
    if proc.returncode == 0:
        _emit_job_progress(job_id, 100.0, None)
        return True, None
    return False, _extract_error_line(stderr)


def _process_one(idx, job, ffmpeg_path):
    """Process a single job. Thread-safe."""
    if not isinstance(job, dict):
        logger.error("Job %d: invalid payload (expected object, got %s)", idx, type(job).__name__)
        _safe_print(json.dumps({"type": "error", "index": idx,
                                "error": "Invalid job payload"}))
        return {"index": idx, "status": "failed"}

    input_path = job.get("input_path")
    output_path = job.get("output_path")
    fname = os.path.basename(input_path) if input_path else "unknown"
    # Use the job's explicit id (which is the queue index) so single-job
    # runs and batch runs report the same identifier the renderer expects.
    job_id = job.get("id", idx)

    if _check_cancelled():
        return {"index": job_id, "status": "cancelled"}

    if not input_path or not os.path.exists(input_path):
        logger.error("Job %d: input not found: %s", idx, input_path)
        _safe_print(json.dumps({"type": "error", "index": job_id,
                                "error": f"Input not found: {input_path}"}))
        return {"index": job_id, "status": "failed"}

    if os.path.abspath(input_path) == os.path.abspath(output_path):
        logger.error("Job %d: output path equals input, skipping: %s", idx, input_path)
        _safe_print(json.dumps({"type": "error", "index": job_id,
                                "error": "Output would overwrite input file"}))
        return {"index": job_id, "status": "failed"}

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    raw_operations = job.get("operations", [])

    if not raw_operations:
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
            _safe_print(json.dumps({"type": "error", "index": job_id, "error": err}))
            return {"index": job_id, "status": "failed"}

    info = job_video_info(job, input_path)
    vw = int(job.get("source_width") or job.get("width") or info.get("width") or 0)
    vh = int(job.get("source_height") or job.get("height") or info.get("height") or 0)
    duration = float(info.get("duration") or 0)
    if vw <= 0 or vh <= 0:
        err = (
            "No se pudo leer la resolución del video. "
            "Vuelve a importar el archivo o comprueba que ffprobe esté disponible."
        )
        logger.error("Job %d: invalid dimensions %dx%d for %s", idx, vw, vh, fname)
        _safe_print(json.dumps({"type": "error", "index": job_id, "error": err}))
        return {"index": job_id, "status": "failed"}

    operations = [
        _optimize_delogo_for_speed(_normalize_operation(op), vw, vh)
        for op in raw_operations
    ]

    filter_complex, output_label, image_paths = build_filter_complex(operations, vw, vh)

    if filter_complex and not _crop_changes_output_size(operations):
        filter_complex, output_label = _ensure_output_dimensions(
            filter_complex, output_label, vw, vh,
        )

    if not filter_complex and operations:
        err = (
            "Las operaciones no generaron un filtro válido. "
            "Comprueba que cada región tenga tamaño suficiente y esté dentro del video."
        )
        logger.error("Job %d: empty filter graph with %d ops", idx, len(operations))
        _safe_print(json.dumps({"type": "error", "index": job_id, "error": err}))
        return {"index": job_id, "status": "failed"}

    src_pix_fmt = job.get("pix_fmt") or info.get("pix_fmt", "yuv420p")
    src_frame_rate = job.get("frame_rate") or info.get("frame_rate", 0)
    src_audio_codec = job.get("audio_codec") or info.get("audio_codec", "")
    encode_profile = job.get("encode_profile", "balanced")
    hw_encoder = detect_hw_encoder(ffmpeg_path)

    def _build_cmd(force_software=False):
        loglevel = "info" if duration > 0 else "error"
        cmd = [ffmpeg_path, "-y", "-loglevel", loglevel]
        if not force_software:
            cmd += build_hwaccel_args(hw_encoder, has_video_filters=bool(filter_complex))
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
        cmd += build_encode_args(ffmpeg_path, encode_profile, job, force_software=force_software)
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
        hw_encoder or "libx264",
    )

    # Dynamic timeout: base 5 mins + 2x video duration, min 10 mins, max 2 hours
    estimated_timeout = max(600, min(7200, int(duration * 2 + 300)))

    ok, err = _run_ffmpeg(
        _build_cmd(), timeout_sec=estimated_timeout, job_id=job_id, duration_sec=duration,
    )

    # GPU encode can fail (-22) or destabilize the display stack — retry on CPU
    if not ok:
        hw = detect_hw_encoder(ffmpeg_path)
        if hw and _is_hardware_encode_error(err):
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
        _safe_print(json.dumps({"type": "error", "index": job_id, "error": err or "Unknown error"}))
        return {"index": job_id, "status": "failed", "error": err or "Unknown error"}


def _execute_batch(jobs, ffmpeg_path, max_workers, *, emit_batch_progress=True):
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
            result = {"index": job_id, "status": "failed", "error": str(e)}

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
            fut = executor.submit(_process_one, i, job, ffmpeg_path)
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


def process_jobs(jobs, ffmpeg_path, max_workers=None):
    """Process jobs concurrently. Report progress to stdout."""
    global _cancel_event, _jobs_file, _BATCH_ACTIVE_WORKERS
    _cancel_event.clear()
    _last_job_progress_emit.clear()

    # Warm font cache before parallel workers hit drawtext
    get_system_fonts()

    hw = detect_hw_encoder(ffmpeg_path)
    max_pixels = 0
    for job in jobs:
        if not isinstance(job, dict):
            continue
        w = int(job.get("source_width") or job.get("width") or 0)
        h = int(job.get("source_height") or job.get("height") or 0)
        if w > 0 and h > 0:
            max_pixels = max(max_pixels, w * h)

    if max_workers is None:
        max_workers = resolve_max_workers(hw, len(jobs), max_pixels)

    total = len(jobs)
    mode = (os.environ.get("BERU_WORKERS_MODE") or "balanced").strip().lower()
    logger.info(
        "Starting batch: %d jobs, %d workers (mode=%s, encoder=%s, max_px=%d), ffmpeg=%s",
        total, max_workers, mode, hw or "libx264", max_pixels, ffmpeg_path,
    )

    pass1 = _execute_batch(jobs, ffmpeg_path, max_workers, emit_batch_progress=True)
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
        reduced_workers = max(1, max_workers // 2)
        logger.info(
            "Retry pass: %d failed jobs at %d workers (was %d)",
            len(retry_candidates), reduced_workers, max_workers,
        )
        pass2 = _execute_batch(
            retry_candidates, ffmpeg_path, reduced_workers, emit_batch_progress=False,
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
    return {"total": total, "succeeded": succeeded, "failed": failed + cancelled}


def main():
    global FFMPEG, FFPROBE, _jobs_file

    if len(sys.argv) < 2:
        logger.error("Missing jobs.json argument")
        print(json.dumps({"type": "error", "error": "Usage: processor.py <jobs.json>"}))
        sys.exit(1)

    _jobs_file = sys.argv[1]

    ffmpeg_bin = find_ffmpeg()
    ffprobe_bin = find_ffprobe(ffmpeg_bin)
    if not (os.path.isfile(ffmpeg_bin) or shutil.which(ffmpeg_bin)):
        logger.error("ffmpeg not found at %s", ffmpeg_bin)
        print(json.dumps({"type": "error", "error": f"ffmpeg not found at {ffmpeg_bin}"}))
        sys.exit(1)

    FFMPEG = ffmpeg_bin
    FFPROBE = ffprobe_bin
    logger.info("Using ffmpeg: %s", FFMPEG)
    logger.info("Using ffprobe: %s", FFPROBE)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        payload = json.load(f)

    if isinstance(payload, list):
        jobs = payload
    elif isinstance(payload, dict) and isinstance(payload.get("jobs"), list):
        jobs = payload["jobs"]
    else:
        logger.error("Invalid jobs file: expected array or {jobs:[]}")
        print(json.dumps({"type": "error", "error": "Invalid jobs manifest"}))
        sys.exit(1)

    get_system_fonts()
    result = process_jobs(jobs, FFMPEG)
    print(json.dumps({"type": "summary", **result}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logging.getLogger("beru").exception("Fatal processor error")
        print(json.dumps({"type": "error", "error": str(exc)}))
        sys.exit(1)
