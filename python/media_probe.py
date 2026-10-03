"""FFmpeg/ffprobe discovery and media probing.

Owns binary paths initialized from env and updated by processor._init_ffmpeg_globals.
"""

import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path

from encode_args import _AUDIO_COPY_CODECS, _COPY_SAFE_STREAM_TYPES, _FASTSTART_EXTS
from job_classify import _job_dimensions

logger = logging.getLogger("beru")

FFMPEG = os.environ.get("BERU_FFMPEG", "ffmpeg.exe")
FFPROBE = os.environ.get("BERU_FFPROBE", "ffprobe.exe")


def find_ffmpeg():
    """Locate ffmpeg binary - bundled, env var, or system PATH."""
    env_ffmpeg = os.environ.get("BERU_FFMPEG")
    if env_ffmpeg and os.path.isfile(env_ffmpeg):
        return env_ffmpeg

    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    bundled = project_root / "bin" / "ffmpeg.exe"
    if bundled.exists():
        return str(bundled)

    found = shutil.which("ffmpeg.exe")
    if found:
        return found
    return "ffmpeg.exe"


def find_ffprobe(ffmpeg_bin):
    """Locate ffprobe alongside ffmpeg, bundled resources, or system PATH."""
    env_ffprobe = os.environ.get("BERU_FFPROBE")
    if env_ffprobe and os.path.isfile(env_ffprobe):
        return env_ffprobe

    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    candidates = [
        Path(ffmpeg_bin).with_name("ffprobe.exe"),
        project_root / "bin" / "ffprobe.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    found = shutil.which("ffprobe.exe")
    if found:
        return found
    return ffmpeg_bin.replace("ffmpeg.exe", "ffprobe.exe")


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
    return {"width": 0, "height": 0, "duration": 0, "video_end": 0,
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


def _ffprobe_via_ffmpeg(path, *, ffmpeg_bin=None):
    """Fallback when ffprobe returns no JSON (common on some Windows builds)."""
    empty = _empty_probe_result()
    candidate = FFMPEG if ffmpeg_bin is None else ffmpeg_bin
    ffmpeg_path = candidate if candidate and os.path.isfile(candidate) else find_ffmpeg()
    if not ffmpeg_path or not os.path.isfile(ffmpeg_path):
        return empty
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-i", path],
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
        rotation_match = (re.search(r"rotation of\s+([-\d.]+)\s+degrees", text, re.I)
                          or re.search(r"\brotate\s*:\s*([-\d.]+)", text, re.I))
        width, height = _display_dimensions(width, height, rotation_match.group(1) if rotation_match else 0)
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


def _video_stream_end(stream):
    duration = _safe_float(stream.get("duration", 0))
    if duration <= 0:
        duration = _safe_float(stream.get("duration_ts", 0)) * _parse_frame_rate(
            stream.get("time_base", "")
        )
    if duration <= 0:
        return 0
    return _safe_float(stream.get("start_time", 0)) + duration


def _display_dimensions(width, height, rotation):
    degrees = _safe_float(rotation)
    if not (-float("inf") < degrees < float("inf")):
        return width, height
    turns = round(degrees / 90)
    if abs(degrees - turns * 90) < 1 and abs(turns) % 2 == 1:
        return height, width
    return width, height


def ffprobe(path, *, ffprobe_bin=None, ffmpeg_bin=None):
    """Get comprehensive video metadata for quality-preserving export."""
    empty = _empty_probe_result()
    if not path or not os.path.exists(path):
        return empty
    probe_bin = FFPROBE if ffprobe_bin is None else ffprobe_bin
    if not probe_bin or not os.path.isfile(probe_bin):
        logger.warning("ffprobe binary not found: %s", probe_bin)
        return _ffprobe_via_ffmpeg(path, ffmpeg_bin=ffmpeg_bin)
    try:
        result = subprocess.run(
            [probe_bin, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=30
        )
        raw = (result.stdout or "").strip()
        if not raw:
            err_snip = (result.stderr or "").strip()[:300]
            logger.warning(
                "ffprobe empty output for %s (exit %s): %s",
                os.path.basename(path), result.returncode, err_snip,
            )
            return _ffprobe_via_ffmpeg(path, ffmpeg_bin=ffmpeg_bin)
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
            return _ffprobe_via_ffmpeg(path, ffmpeg_bin=ffmpeg_bin)

        rotation = next((data["rotation"] for data in video_stream.get("side_data_list", [])
                         if data.get("rotation") is not None), video_stream.get("tags", {}).get("rotate", 0))
        width, height = _display_dimensions(
            _safe_int(video_stream.get("width", 0)), _safe_int(video_stream.get("height", 0)), rotation,
        )

        return {
            "width": width,
            "height": height,
            "duration": _safe_float(fmt.get("duration", 0)),
            "video_end": _video_stream_end(video_stream),
            "video_codec": video_stream.get("codec_name", ""),
            "pix_fmt": video_stream.get("pix_fmt", "yuv420p"),
            "bit_rate": _safe_int(fmt.get("bit_rate", 0)) or _safe_int(video_stream.get("bit_rate", 0)),
            "frame_rate": _parse_frame_rate(video_stream.get("r_frame_rate") or video_stream.get("avg_frame_rate", "")),
            "audio_codec": audio_stream.get("codec_name", "") if audio_stream else "",
            "audio_channels": _safe_int(audio_stream.get("channels", 0)) if audio_stream else 0,
        }
    except Exception as e:
        logger.warning("ffprobe failed for %s: %s", os.path.basename(path), e)
    return _ffprobe_via_ffmpeg(path, ffmpeg_bin=ffmpeg_bin)


def _probe_stream_types(path, *, ffprobe_bin=None):
    """[(codec_type, codec_name)] for each stream; None when ffprobe fails."""
    probe_bin = FFPROBE if ffprobe_bin is None else ffprobe_bin
    if not probe_bin or not os.path.isfile(probe_bin):
        return None
    try:
        result = subprocess.run(
            [
                probe_bin, "-v", "error", "-show_entries",
                "stream=codec_type,codec_name", "-of", "json", path,
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return None
        info = json.loads(result.stdout or "{}")
        return [
            (s.get("codec_type") or "", (s.get("codec_name") or "").lower())
            for s in info.get("streams") or []
        ]
    except Exception:
        return None


def _moov_precedes_mdat(path):
    """Walk mp4 top-level boxes; True when moov already sits before mdat
    (the source is already faststart, so a byte copy preserves it)."""
    try:
        with open(path, "rb") as f:
            while True:
                header = f.read(8)
                if len(header) < 8:
                    return False
                size = int.from_bytes(header[:4], "big")
                box_type = header[4:8]
                header_size = 8
                if size == 1:
                    ext = f.read(8)
                    if len(ext) < 8:
                        return False
                    size = int.from_bytes(ext, "big")
                    header_size = 16
                if box_type == b"moov":
                    return True
                if box_type == b"mdat" or size == 0 or size < header_size:
                    return False
                f.seek(size - header_size, os.SEEK_CUR)
    except OSError:
        return False


def _native_copy_eligible(input_path, output_path, *, probe_fn=None):
    """A byte copy is observably identical to the ffmpeg remux only when the
    output keeps the same container, the source has at most one stream per
    type (the remux would drop extras via default stream selection), the
    audio codec already fits the container, and — for the mp4 family — moov
    already precedes mdat so the faststart layout is preserved. Any doubt
    falls back to the remux."""
    in_ext = os.path.splitext(input_path)[1].lower()
    if not in_ext or in_ext != os.path.splitext(output_path)[1].lower():
        return False
    streams = (probe_fn or _probe_stream_types)(input_path)
    if not streams:
        return False
    counts = {}
    audio_codec = ""
    for codec_type, codec_name in streams:
        if codec_type not in _COPY_SAFE_STREAM_TYPES:
            return False
        counts[codec_type] = counts.get(codec_type, 0) + 1
        if codec_type == "audio" and not audio_codec:
            audio_codec = codec_name
    if any(c > 1 for c in counts.values()):
        return False
    if audio_codec and audio_codec not in _AUDIO_COPY_CODECS.get(in_ext, frozenset()):
        return False
    if in_ext in _FASTSTART_EXTS:
        return _moov_precedes_mdat(input_path)
    return True


def job_video_info(job, input_path, *, probe_fn=None):
    """Use metadata from the job when Electron already probed the file."""
    jw, jh = _job_dimensions(job)
    duration = float(job.get("video_duration") or 0)
    frame_rate = float(job.get("frame_rate") or 0)
    already_probed = job.get("video_info_probed", duration > 0 and bool(job.get("pix_fmt")))
    if jw > 0 and jh > 0 and already_probed:
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
    probed = (probe_fn or ffprobe)(input_path)
    if jw > 0 and jh > 0:
        probed["width"] = jw
        probed["height"] = jh
    return probed
