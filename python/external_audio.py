"""Compose one external asset on the output clock; video owns the final duration."""
import math
from audio_settings import audio_filter
from clip_timing import playback_rate, tempo_filter


def build_external_audio_graph(job, index, duration, source_info, asset_info):
    asset = job["external_audio"]
    if not asset_info.get("audio_codec") or not (asset_info.get("duration", 0) > 0):
        raise ValueError("External file contains no valid audio")
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Video duration is required for external audio")
    offset = float(asset.get("offset", 0))
    start = float(asset.get("trim_start", 0))
    end = asset.get("trim_end")
    end = float(end) if end is not None else float(asset_info["duration"])
    gain = float(asset.get("gain", 1))
    if not all(math.isfinite(n) for n in (offset, start, end, gain)) or offset < 0 or start < 0 or end <= start or not 0 <= gain <= 1:
        raise ValueError("Invalid external audio range or gain")
    mode = asset.get("mode", "mix")
    if mode not in ("mix", "replace"):
        raise ValueError("Invalid external audio mode")
    has_original = bool(source_info.get("audio_codec")) and mode == "mix"
    channels = int(source_info.get("audio_channels") if has_original else asset_info.get("audio_channels") or 1)
    layout = {1: "mono", 2: "stereo", 6: "5.1", 8: "7.1"}.get(channels, f"{channels}c")
    tail = f"aformat=sample_rates=48000:channel_layouts={layout},apad=whole_dur={duration:.6f},atrim=duration={duration:.6f}"
    added = f"[{index}:a:0]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS,volume={gain:.6f},adelay=delays={round(offset * 1000)}:all=1,{tail}[added_audio]"
    if not has_original:
        return added, "[added_audio]", channels
    trim_start = float(job.get("trim_start") or 0)
    trim_end = job.get("trim_end")
    original = f"atrim=start={trim_start:.6f}"
    if trim_end is not None:
        original += f":end={float(trim_end):.6f}"
    original += ",asetpts=PTS-STARTPTS"
    tempo = tempo_filter(playback_rate(job))
    if tempo:
        original += f",{tempo}"
    af = audio_filter({**job, "audio_codec": source_info.get("audio_codec"), "audio_channels": channels})
    if af:
        original += f",{af}"
    graph = f"[0:a:0]{original},{tail}[original_audio];{added};[original_audio][added_audio]amix=inputs=2:weights='0.5 0.5':normalize=0:duration=longest[composed_audio]"
    return graph, "[composed_audio]", channels
