import os

import encoders
from encode_profiles import ENCODE_PROFILES, profile_allows_hardware

_AUDIO_COPY_CODECS = {
    ".mp4": frozenset({"aac", "mp3", "mp4a"}),
    ".mov": frozenset({"aac", "mp3", "alac"}),
    ".m4v": frozenset({"aac"}),
    ".mkv": frozenset({"aac", "mp3", "opus", "flac", "vorbis", "eac3", "ac3"}),
    ".avi": frozenset({"mp3", "ac3", "pcm_s16le", "pcm_s24le"}),
}

_FASTSTART_EXTS = frozenset({".mp4", ".mov", ".m4v"})

_COPY_SAFE_STREAM_TYPES = frozenset({"video", "audio"})

_ANIMATED_IMAGE_EXTS = frozenset({".gif", ".webp", ".apng", ".avif", ".mng"})


def build_audio_args(output_path, src_audio_codec, src_audio_channels=0, force_encode=False, audio_map="0:a?"):
    """Copy audio when the container supports the source codec; else AAC.

    When re-encoding to AAC, preserve the source channel layout (mono -> mono,
    5.1 -> 5.1) so surround sources don't silently downmix to stereo.
    """
    ext = os.path.splitext(output_path)[1].lower()
    codec = (src_audio_codec or "").lower()
    if not force_encode and codec and codec in _AUDIO_COPY_CODECS.get(ext, frozenset()):
        return ["-map", audio_map, "-c:a", "copy"]
    args = ["-map", audio_map, "-c:a", "aac", "-b:a", "192k"]
    channels = int(src_audio_channels or 0)
    if 1 <= channels <= 16:
        args += ["-ac", str(channels)]
    return args


def build_filter_thread_args(active_workers=1):
    workers = active_workers
    cpus = os.cpu_count() or 4
    n = max(1, min(4, cpus // max(1, int(workers))))
    return ["-filter_threads", str(n), "-filter_complex_threads", str(n)]


def resolve_x264_threads(active_workers=1):
    workers = active_workers
    cpus = os.cpu_count() or 4
    return max(1, min(8, cpus // max(1, int(workers))))


def build_encode_args(ffmpeg_path, profile_name, job, force_software=False,
                      hw_encoder=None, active_workers=1):
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
        hw = encoders.detect_hw_encoder(ffmpeg_path)
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
        gq = profile.get("hw_cq", 23)
        return ["-c:v", "h264_mf", "-rate_control", "quality", "-quality", str(gq)]

    if hw == "h264_amf":
        quality = (
            "speed" if profile_key == "fast"
            else "quality" if profile_key == "quality"
            else "balanced"
        )
        return ["-c:v", "h264_amf", "-quality", quality]

    preset = job.get("speed_preset") or profile["preset"]
    threads = resolve_x264_threads(active_workers)
    return [
        "-c:v", "libx264",
        "-crf", str(profile["crf"]),
        "-preset", preset,
        "-threads", str(threads),
    ]
