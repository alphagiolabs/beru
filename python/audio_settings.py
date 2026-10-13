"""Exportable audio settings of a video: gain (attenuation only) and mute.

Mirrors src/utils/audio-settings.js. Silencing keeps the original audio track
(volume 0), so the output has the same streams as the source.
"""


def normalize_audio(job):
    """Audio fields of a job; missing or invalid values fall back to identity."""
    if not isinstance(job, dict):
        return {"gain": 1.0, "muted": False}
    try:
        gain = float(job.get("audio_gain", 1.0))
    except (TypeError, ValueError):
        gain = 1.0
    if gain != gain or gain in (float("inf"), float("-inf")):
        gain = 1.0
    gain = min(1.0, max(0.0, gain))
    return {"gain": gain, "muted": job.get("audio_muted") is True}


def has_audio_source(job):
    """True when the probed source carries an audio stream."""
    if not isinstance(job, dict):
        return False
    try:
        channels = int(job.get("audio_channels") or 0)
    except (TypeError, ValueError):
        channels = 0
    return bool(job.get("audio_codec")) or channels > 0


def audio_filter(job):
    """ffmpeg audio filter for the job's audio edits, or None when nothing changes
    or the source has no audio to edit."""
    if not has_audio_source(job):
        return None
    settings = normalize_audio(job)
    if settings["muted"]:
        return "volume=0"
    if settings["gain"] < 1.0:
        return f"volume={settings['gain']:.4f}"
    return None
