"""Composition boundaries from the contract used by JavaScript."""
import json
import math
import sys
from pathlib import Path
from clip_timing import MIN_RATE, MAX_RATE, MIN_REPEAT_COUNT, MAX_REPEAT_COUNT, MAX_OUTPUT_DURATION_SECONDS
from composition_overlays import CompositionError, OVERLAY_MAX_COUNT, validate_overlay

root = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
with (root / "resources" / "composition-limits.json").open(encoding="utf-8") as handle:
    LIMITS = json.load(handle)
LIMITS.update({
    "minRate": MIN_RATE,
    "maxRate": MAX_RATE,
    "minRepeatCount": MIN_REPEAT_COUNT,
    "maxRepeatCount": MAX_REPEAT_COUNT,
    "maxDurationSeconds": MAX_OUTPUT_DURATION_SECONDS,
})


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_composition_job(job):
    if not isinstance(job, dict) or job.get("kind") != "composition":
        raise CompositionError("Invalid composition job")
    canvas = job.get("canvas") or {}
    for key in ("width", "height"):
        value = canvas.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or not LIMITS["minCanvasDimension"] <= value <= LIMITS["maxCanvasDimension"] or value % 2:
            raise CompositionError("Invalid composition canvas")
    if canvas.get("fit", "contain") not in ("contain", "cover"):
        raise CompositionError("Invalid composition fit")
    background = canvas.get("background", "#000000")
    if not isinstance(background, str) or len(background) != 7 or background[0] != "#" or any(c not in "0123456789abcdefABCDEF" for c in background[1:]):
        raise CompositionError("Invalid composition background")
    fps = job.get("composition_fps")
    if not number(fps) or not LIMITS["minFps"] <= fps <= LIMITS["maxFps"]:
        raise CompositionError("Invalid composition FPS")
    clips = job.get("clips")
    if not isinstance(clips, list) or not 1 <= len(clips) <= LIMITS["maxClips"]:
        raise CompositionError(f"Composition requires 1–{LIMITS['maxClips']} video entries")
    duration = 0
    for clip in clips:
        if not isinstance(clip, dict) or clip.get("kind") not in (None, "video"):
            raise CompositionError("Invalid composition entry")
        start = clip.get("trim_start", 0)
        end = clip.get("trim_end")
        if end is None:
            end = clip.get("video_duration")
        if not number(start) or not number(end) or start < 0 or end <= start or end > clip.get("video_duration", 0):
            raise CompositionError("Invalid composition source interval")
        rate = clip.get("playback_rate", 1)
        repeat = clip.get("repeat_count", 1)
        if not number(rate) or not LIMITS["minRate"] <= rate <= LIMITS["maxRate"]:
            raise CompositionError("Invalid composition playback rate")
        if not isinstance(repeat, int) or isinstance(repeat, bool) or not LIMITS["minRepeatCount"] <= repeat <= LIMITS["maxRepeatCount"]:
            raise CompositionError("Invalid composition repeats")
        if "audio_muted" in clip and not isinstance(clip["audio_muted"], bool):
            raise CompositionError("Invalid composition mute")
        framing = clip.get("framing")
        if framing is not None:
            if not isinstance(framing, dict) or framing.get("fit") not in ("contain", "cover"):
                raise CompositionError("Invalid composition framing")
            for key, low, high in (("zoom", 1, 4), ("offsetX", -1, 1), ("offsetY", -1, 1)):
                if not number(framing.get(key)) or not low <= framing[key] <= high:
                    raise CompositionError("Invalid composition framing")
            crop = framing.get("crop") or {}
            for key, low in (("x", 0), ("y", 0), ("w", .05), ("h", .05)):
                if not number(crop.get(key)) or not low <= crop[key] <= 1:
                    raise CompositionError("Invalid composition crop")
            if crop["x"] + crop["w"] > 1 + 1e-9 or crop["y"] + crop["h"] > 1 + 1e-9:
                raise CompositionError("Invalid composition crop")
        duration += math.ceil((end - start) / rate * repeat * fps - 1e-8) / fps
    overlays = job.get("overlays", [])
    if not isinstance(overlays, list) or len(overlays) > OVERLAY_MAX_COUNT:
        raise CompositionError("Invalid composition overlays")
    for overlay in overlays:
        if not isinstance(overlay, dict):
            raise CompositionError("Invalid composition overlay")
        validate_overlay(overlay)
        duration = max(duration, overlay["endUs"] / 1e6)
    if duration > LIMITS["maxDurationSeconds"]:
        raise CompositionError("Composition exceeds maximum duration")
    frame = job.get("frame")
    if frame is not None and (not isinstance(frame, dict) or not number(frame.get("atUs")) or not isinstance(frame["atUs"], int) or not 0 <= frame["atUs"] < duration * 1e6):
        raise CompositionError("Frame is outside the composition")
