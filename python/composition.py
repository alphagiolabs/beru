"""The canonical composition processor, used by Batch and Editor jobs."""
import math
import os
import tempfile
from fractions import Fraction

import media_probe
from batch_context import _check_cancelled
from batch_errors import is_hardware_encode_error, remove_partial_output
from clip_timing import cycle_duration, repeat_count, playback_rate
from composition_graph import build_filter_graph, seek_args
from composition_limits import LIMITS, validate_composition_job
from composition_overlays import image_input_args, overlays_at_frame, prepare_overlay_workdir
from media_paths import _validated_job_media


def _needs_intermediate(clip):
    return bool(
        clip.get("operations") or clip.get("watermark") or clip.get("external_audio")
        or repeat_count(clip) > 1 or clip.get("output_height")
    )


def _frame_clips(clips, infos, durations, at_us, fps):
    offset = at_us / 1e6
    for clip, info, duration in zip(clips, infos, durations):
        if offset < duration - 1e-9:
            rate = playback_rate(clip)
            start = (clip.get("trim_start") or 0) + min(offset, cycle_duration(clip, info["duration"])) * rate
            end = clip.get("trim_end") if clip.get("trim_end") is not None else info["duration"]
            start = min(start, end - min(1 / fps, end / 2))
            single = {
                **clip, "trim_start": start,
                "trim_end": min(end, start + max(1, rate) / fps), "playback_rate": 1,
            }
            return [single], [info], [1 / fps]
        offset -= duration
    return [], [], []


def process_composition(job, ffmpeg_path, *, ctx, render_clip, run_ffmpeg, encode_args):
    validate_composition_job(job)
    job = _validated_job_media(job, require_output=True)
    fps = job["composition_fps"]
    frame = job.get("frame")
    overlays = job.get("overlays", [])
    job_id = job.get("id", -1)
    clips, infos, durations = [], [], []
    run_directory = os.path.dirname(os.path.abspath(ctx.jobs_file)) if ctx and ctx.jobs_file else None
    probe_bin = ctx.ffprobe_path if ctx else media_probe.find_ffprobe(ffmpeg_path)
    output = job["output_path"]
    output_key = os.path.normcase(os.path.realpath(output))
    sources = [clip["input_path"] for clip in job["clips"]]
    sources += [overlay["source"]["path"] for overlay in overlays if overlay["kind"] == "image"]
    if any(os.path.normcase(os.path.realpath(source)) == output_key for source in sources):
        raise ValueError("Composition output would overwrite a source")
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="beru-composition-", dir=run_directory) as directory:
        for index, original in enumerate(job["clips"]):
            if _check_cancelled(ctx):
                raise RuntimeError("Cancelled")
            clip = original
            info = media_probe.ffprobe(clip["input_path"], ffmpeg_bin=ffmpeg_path, ffprobe_bin=probe_bin)
            if not info.get("width") or not info.get("height") or info.get("color_transfer") in ("smpte2084", "arib-std-b67"):
                raise ValueError("Composition supports readable SDR video only")
            duration = cycle_duration(clip, info["duration"]) * repeat_count(clip)
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("Invalid composition entry duration")
            duration = math.ceil(duration * fps - 1e-8) / fps
            if _needs_intermediate(clip):
                destination = os.path.join(directory, f"edited-{index}.mkv")
                render_clip({**clip, "id": job_id, "output_path": destination, "output_root": directory,
                             "rotation": 0, "flip_h": False, "flip_v": False},
                            progress_range=(0, 10), force_video_encode=True)
                clip = {**clip, "input_path": destination, "input_root": directory, "trim_start": 0,
                        "trim_end": duration, "video_duration": duration, "playback_rate": 1,
                        "repeat_count": 1, "audio_gain": 1, "audio_muted": False}
                info = media_probe.ffprobe(destination, ffmpeg_bin=ffmpeg_path, ffprobe_bin=probe_bin)
            clips.append(clip)
            infos.append(info)
            durations.append(duration)
        total = max(sum(durations), max((overlay["endUs"] / 1e6 for overlay in overlays), default=0))
        if total > LIMITS["maxDurationSeconds"]:
            raise ValueError("Composition exceeds maximum duration")
        if frame:
            clips, infos, durations = _frame_clips(clips, infos, durations, frame["atUs"], fps)
            overlays = overlays_at_frame(overlays, frame["atUs"])
        workdir = prepare_overlay_workdir(overlays, directory)
        graph = build_filter_graph(clips, infos, durations, canvas=job["canvas"], fps=fps,
                                   overlays=overlays, with_audio=not frame, total=None if frame else total)
        graph_path = os.path.join(directory, "composition.graph")
        with open(graph_path, "w", encoding="utf-8") as handle:
            handle.write(graph)
        cmd = [ffmpeg_path, "-nostdin", "-xerror", "-y", "-loglevel", "error", "-progress", "pipe:2", "-nostats"]
        for clip in clips:
            cmd += seek_args(clip) + ["-i", clip["input_path"]]
        cmd += image_input_args(overlays)
        cmd += ["-filter_complex_threads", "1", "-/filter_complex", graph_path, "-map", "[vout]"]
        if frame:
            cmd += ["-frames:v", "1", "-f", "image2", "-c:v", "png", output]
            ok, error = run_ffmpeg(cmd, job_id=job_id, duration_sec=1 / fps, ctx=ctx, cwd=workdir)
        else:
            cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
                    "-pix_fmt", "yuv420p", "-r", str(Fraction(fps).limit_denominator(1_000_000)), "-t", f"{total:.9f}",
                    "-colorspace", "bt709", "-color_trc", "bt709", "-color_primaries", "bt709", "-color_range", "tv"]
            if os.path.splitext(output)[1].lower() in (".mp4", ".mov"):
                cmd += ["-movflags", "+faststart"]
            force_software = bool(job.get("_hw_failed"))
            options = encode_args(ffmpeg_path, job.get("encode_profile", "balanced"), job,
                                  force_software=force_software, hw_encoder=ctx.hw_encoder if ctx else None,
                                  active_workers=ctx.max_workers if ctx else 1)
            ok, error = run_ffmpeg(cmd + options + [output], job_id=job_id, duration_sec=total,
                                  ctx=ctx, progress_range=(10 if any(_needs_intermediate(c) for c in job["clips"]) else 0, 100), cwd=workdir)
            if not ok and not _check_cancelled(ctx) and is_hardware_encode_error(error or ""):
                options = encode_args(ffmpeg_path, job.get("encode_profile", "balanced"), job,
                                      force_software=True, active_workers=ctx.max_workers if ctx else 1)
                ok, error = run_ffmpeg(cmd + options + [output], job_id=job_id, duration_sec=total, ctx=ctx, cwd=workdir)
        if not ok:
            remove_partial_output(output)
            if "No space left on device" in (error or ""):
                error = "No hay espacio suficiente en el disco para exportar."
            raise RuntimeError(error)
    return {"index": job_id, "status": "succeeded"}
