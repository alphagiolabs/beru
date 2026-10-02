"""Codec/container constants and audio-argument builders.

Video/thread builders stay in processor.py to read _BATCH_ACTIVE_WORKERS.
"""

import os

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


def build_audio_args(output_path, src_audio_codec, src_audio_channels=0, force_encode=False):
    """Copy audio when the container supports the source codec; else AAC.

    When re-encoding to AAC, preserve the source channel layout (mono -> mono,
    5.1 -> 5.1) so surround sources don't silently downmix to stereo.
    """
    ext = os.path.splitext(output_path)[1].lower()
    codec = (src_audio_codec or "").lower()
    if not force_encode and codec and codec in _AUDIO_COPY_CODECS.get(ext, frozenset()):
        return ["-map", "0:a?", "-c:a", "copy"]
    args = ["-map", "0:a?", "-c:a", "aac", "-b:a", "192k"]
    channels = int(src_audio_channels or 0)
    if 1 <= channels <= 16:
        args += ["-ac", str(channels)]
    return args
