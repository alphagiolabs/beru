"""One filter graph for canonical composition clips, frames and global layers."""
from fractions import Fraction

from audio_settings import normalize_audio
from clip_timing import playback_rate, tempo_filter
from composition_overlays import build_overlay_filters
from frame_geometry import normalize_transform


def seek_args(clip):
    start = clip.get("trim_start") or 0
    return ["-ss", f"{start:.9f}"] if start > 0 else []


def clip_video_filters(clip, canvas, fps, duration, info):
    fps_text = str(Fraction(fps).limit_denominator(1_000_000))
    start = clip.get("trim_start") or 0
    end = clip.get("trim_end")
    window = (end if end is not None else clip["video_duration"]) - start
    rate = playback_rate(clip)
    filters = [f"trim=start=0:end={window:.9f}", f"setpts=(PTS-STARTPTS)/{rate:.9f}"]
    framing = {"crop": {"x": 0, "y": 0, "w": 1, "h": 1}, "fit": canvas.get("fit", "contain"),
               "zoom": 1, "offsetX": 0, "offsetY": 0, **(clip.get("framing") or {})}
    crop = framing["crop"]
    if (crop["x"], crop["y"], crop["w"], crop["h"]) != (0, 0, 1, 1):
        filters.append(f"crop=trunc(iw*{crop['w']:.9f}/2)*2:trunc(ih*{crop['h']:.9f}/2)*2:"
                       f"trunc(iw*{crop['x']:.9f}/2)*2:trunc(ih*{crop['y']:.9f}/2)*2")
    transform = normalize_transform(clip)
    if transform["rotation"] == 90:
        filters.append("transpose=1")
    elif transform["rotation"] == 270:
        filters.append("transpose=2")
    elif transform["rotation"] == 180:
        filters.append("hflip,vflip")
    if transform["flip_h"]:
        filters.append("hflip")
    if transform["flip_v"]:
        filters.append("vflip")
    aspect = "decrease" if framing["fit"] == "contain" else "increase"
    filters.append(f"scale={canvas['width']}:{canvas['height']}:force_original_aspect_ratio={aspect}:force_divisible_by=2:reset_sar=1")
    if framing["zoom"] != 1:
        filters.append(f"scale=trunc(iw*{framing['zoom']:.9f}/2)*2:trunc(ih*{framing['zoom']:.9f}/2)*2")
    color = "colorspace=all=bt709"
    if not all(info.get(k) and info[k] != "unknown" for k in ("color_space", "color_transfer", "color_primaries")):
        color += ":iall=bt709"
    color += ":irange=pc" if info.get("color_range") == "pc" else ":irange=tv"
    filters.extend([color, "setsar=1", "format=yuv420p", f"fps={fps_text}",
                    f"tpad=stop_mode=clone:stop_duration={duration:.9f}", f"trim=duration={duration:.9f}", "setpts=PTS-STARTPTS"])
    return filters, framing


def audio_chain(clip, index, info, duration):
    audio = normalize_audio(clip)
    if audio["muted"] or not info.get("audio_codec"):
        return f"anullsrc=r=48000:cl=stereo,atrim=duration={duration:.9f}[a{index}]"
    window = (clip.get("trim_end") if clip.get("trim_end") is not None else clip["video_duration"]) - (clip.get("trim_start") or 0)
    stages = [f"[{index}:a]atrim=duration={window:.9f}", "asetpts=PTS-STARTPTS"]
    tempo = tempo_filter(playback_rate(clip))
    if tempo:
        stages.append(tempo)
    stages.extend([f"volume={audio['gain']:.9f}", "aformat=sample_rates=48000:channel_layouts=stereo",
                   "aresample=async=1:first_pts=0", f"apad=whole_dur={duration:.9f}", f"atrim=duration={duration:.9f}"])
    return ",".join(stages) + f"[a{index}]"


def build_filter_graph(clips, infos, durations, *, canvas, fps, overlays=(), with_audio=True, total=None):
    width, height = canvas["width"], canvas["height"]
    color = "0x" + canvas.get("background", "#000000")[1:]
    fps_text = str(Fraction(fps).limit_denominator(1_000_000))
    parts, pairs = [], []
    for i, (clip, info, duration) in enumerate(zip(clips, infos, durations)):
        filters, framing = clip_video_filters(clip, canvas, fps, duration, info)
        parts.append(f"[{i}:v]" + ",".join(filters) + f"[layer{i}]")
        parts.append(f"color=c={color}:s={width}x{height}:r={fps_text}:d={duration:.9f}[bg{i}]")
        parts.append(f"[bg{i}][layer{i}]overlay=x=(main_w-overlay_w)/2+({framing['offsetX']:.9f})*main_w:"
                     f"y=(main_h-overlay_h)/2+({framing['offsetY']:.9f})*main_h:shortest=1,setsar=1,format=yuv420p[v{i}]")
        pairs.append(f"[v{i}]")
        if with_audio:
            parts.append(audio_chain(clip, i, info, duration))
            pairs.append(f"[a{i}]")
    tail = max(0, (total or 0) - sum(durations))
    has_tail = tail > 1e-8 or not clips
    if has_tail:
        length = tail if clips else 1 / fps
        parts.append(f"color=c={color}:s={width}x{height}:r={fps_text}:d={length:.9f}[vtail]")
        pairs.append("[vtail]")
        if with_audio:
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={length:.9f}[atail]")
            pairs.append("[atail]")
    count = len(clips) + int(has_tail)
    parts.append(f"{''.join(pairs)}concat=n={count}:v=1:a={int(with_audio)}[vcat]" + ("[aout]" if with_audio else ""))
    parts.extend(build_overlay_filters(overlays, width=width, height=height, first_image_input=len(clips)))
    return ";".join(parts)
