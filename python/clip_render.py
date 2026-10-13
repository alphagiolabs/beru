"""Clip rendering and intermediate media; Job terminal events belong to the caller."""

import logging
import math
import os
import tempfile
from dataclasses import dataclass

import media_probe
from audio_settings import audio_filter, normalize_audio
from batch_context import _check_cancelled
from batch_errors import is_hardware_encode_error, remove_partial_output
from clip_timing import cycle_duration, playback_rate, repeat_count, tempo_filter
from encode_args import _AUDIO_COPY_CODECS, _FASTSTART_EXTS, build_audio_args
from encode_profiles import profile_allows_hardware
from external_audio import build_external_audio_graph
from frame_geometry import normalize_transform
from job_classify import _job_dimensions, _job_takes_copy_path, _parse_trim_window
from media_paths import _validated_job_media
from op_shared import _normalize_operation
from temporal_pipeline import TemporalPatchResolver, extra_media_input_args

logger = logging.getLogger("beru")


@dataclass
class VideoPlan:
    job: dict
    command: list
    duration: float
    timeout: int
    encoder: object = None
    software_command: object = None
    native_copy: bool = False
    reserve_software: bool = False


class ClipRenderer:
    """One Job's renders share its hardware failure state and run resources."""

    def __init__(self, ffmpeg_path, *, retry_job, ctx, hw_encoder, active_workers, admission,
                 run_ffmpeg, encode_args, filter_args, build_filters, video_info,
                 native_copy_eligible, native_copy, detect_encoder):
        self.ctx = ctx
        self.retry_job = retry_job
        self.run_directory = os.path.dirname(os.path.abspath(ctx.jobs_file)) if ctx and ctx.jobs_file else None
        self.ffmpeg_path = ctx.ffmpeg_path if ctx else ffmpeg_path
        self.hw_encoder = ctx.hw_encoder if ctx else hw_encoder
        self.workers = ctx.max_workers if ctx else active_workers
        self.admission = ctx.sw_fallback_admission if ctx else admission
        self.run_ffmpeg = run_ffmpeg
        self.encode_args = encode_args
        self.filter_args = filter_args
        self.build_filters = build_filters
        self.video_info = video_info
        self.native_copy_eligible = native_copy_eligible
        self.native_copy = native_copy
        self.detect_encoder = detect_encoder

    def _check_cancelled(self):
        if _check_cancelled(self.ctx):
            raise RuntimeError("Cancelled")

    def _probe(self, path):
        return media_probe.ffprobe(path, ffmpeg_bin=self.ffmpeg_path,
            ffprobe_bin=self.ctx.ffprobe_path if self.ctx else media_probe.find_ffprobe(self.ffmpeg_path))

    def render(self, job, *, progress_range=None, force_video_encode=False):
        self._check_cancelled()
        job = self._validate(job)
        if repeat_count(job) > 1:
            self._render_repeated(job, progress_range, force_video_encode)
        else:
            self._render_once(job, progress_range, force_video_encode)

    def _validate(self, job):
        if not isinstance(job, dict):
            raise ValueError("Invalid job payload")
        validated = _validated_job_media(job, require_output=True)
        if not os.path.exists(validated["input_path"]):
            raise ValueError(f"Input not found: {validated['input_path']}")
        if os.path.normcase(validated["input_path"]) == os.path.normcase(validated["output_path"]):
            raise ValueError("Output would overwrite input file")
        os.makedirs(os.path.dirname(validated["output_path"]) or ".", exist_ok=True)
        return validated

    def _render_once(self, job, progress_range, force_video_encode):
        temporal = any(
            isinstance(op, dict) and str(op.get("mode") or "").lower() == "delogo"
            and str(op.get("delogo_method") or op.get("delogoMethod") or "").lower() in {"temporal", "inpaint"}
            for op in job.get("operations", []) or []
        )
        if temporal:
            with tempfile.TemporaryDirectory(prefix="beru-temporal-", dir=self.run_directory) as directory:
                plan = self._plan(job, directory, force_video_encode)
                self._execute(plan, progress_range)
        else:
            self._execute(self._plan(job, None, force_video_encode), progress_range)

    def _plan(self, job, temporal_directory, force_video_encode):
        try:
            trim_start, trim_end = _parse_trim_window(job)
            if not math.isfinite(trim_start) or trim_start < 0:
                raise ValueError("invalid start")
            if trim_end is not None and (not math.isfinite(trim_end) or trim_end <= trim_start):
                raise ValueError("invalid end")
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid trim range: {exc}") from exc
        rate = playback_rate(job)
        audio = normalize_audio(job)
        external = job.get("external_audio")
        source_info = self._probe(job["input_path"]) if external or rate != 1 or audio["muted"] or audio["gain"] != 1 else {}
        media_job = {**job, "audio_codec": source_info.get("audio_codec", ""),
                     "audio_channels": source_info.get("audio_channels", 0)} if source_info else job
        external_info = self._probe(external["path"]) if external else None
        if not force_video_encode and _job_takes_copy_path(media_job):
            return self._copy_plan(media_job, source_info, external_info)
        return self._encode_plan(job, media_job, source_info, external_info, trim_start, trim_end, rate, temporal_directory)

    def _external_plan(self, job, index, source_info, external_info):
        target = cycle_duration(job, float(source_info.get("duration") or job.get("video_duration") or 0))
        return (*build_external_audio_graph(job, index, target, source_info, external_info), target)

    def _command(self, job, loglevel="error"):
        return [self.ffmpeg_path, "-nostdin", "-xerror", "-y", "-loglevel", loglevel,
                "-progress", "pipe:2", "-nostats", "-i", job["input_path"]]

    def _output_args(self, path):
        return (["-movflags", "+faststart"] if os.path.splitext(path)[1].lower() in _FASTSTART_EXTS else []) + ["-max_muxing_queue_size", "1024", path]

    def _copy_plan(self, job, source_info, external_info):
        output = job["output_path"]
        codec = (job.get("audio_codec") or "").lower()
        audio_af = audio_filter(job)
        cmd = self._command(job)
        if job.get("external_audio"):
            info = {**self.video_info(job, job["input_path"], ctx=self.ctx), **source_info}
            graph, label, channels, duration = self._external_plan(job, 1, info, external_info)
            cmd += ["-i", job["external_audio"]["path"], "-filter_complex", graph, "-map", "0:v:0", "-c:v", "copy"]
            cmd += build_audio_args(output, "", channels, force_encode=True, audio_map=label)
            cmd += ["-t", f"{duration:.6f}"]
        elif audio_af is not None:
            cmd += ["-map", "0:v:0?", "-c:v", "copy"]
            cmd += build_audio_args(output, codec, job.get("audio_channels"), force_encode=True)
            cmd += ["-af", audio_af]
        elif codec and codec not in _AUDIO_COPY_CODECS.get(os.path.splitext(output)[1].lower(), frozenset()):
            cmd += ["-map", "0:v:0?", "-c:v", "copy"]
            cmd += build_audio_args(output, codec, job.get("audio_channels"))
        else:
            cmd += ["-c", "copy"]
        cmd += self._output_args(output)
        try:
            input_bytes = os.path.getsize(job["input_path"])
        except OSError:
            input_bytes = 0
        return VideoPlan(job, cmd, float(job.get("video_duration") or 0),
                         max(300, min(7200, int(input_bytes / (25 * 1024 * 1024)))),
                         native_copy=audio_af is None and not job.get("external_audio"))

    def _encode_plan(self, raw_job, job, source_info, external_info, trim_start, trim_end, rate, temporal_directory):
        info = self.video_info(job, job["input_path"], ctx=self.ctx)
        if rate != 1:
            info = {**info, **source_info}
        width, height = _job_dimensions(job, info)
        duration = float(info.get("duration") or 0)
        output_duration = duration
        if width <= 0 or height <= 0:
            raise ValueError("No se pudo leer la resolución del video: ffprobe no encontró dimensiones válidas "
                             f"para '{os.path.basename(job['input_path'])}'.")
        operations = [_normalize_operation(op) for op in job.get("operations", []) or []]
        temporal_fps = float(info.get("frame_rate") or 0)
        if temporal_directory and temporal_fps <= 0:
            temporal_fps = float(self._probe(job["input_path"]).get("frame_rate") or 0)
        resolver = TemporalPatchResolver(job["input_path"], temporal_directory, self.ffmpeg_path,
            temporal_fps, source_format=info.get("pix_fmt"), ctx=self.ctx) if temporal_directory else None
        graph, label, image_paths = self.build_filters(operations, width, height,
            watermark=job.get("watermark"), _ffmpeg_path=self.ffmpeg_path, source_pix_fmt=info.get("pix_fmt"),
            temporal_resolver=resolver, transform=normalize_transform(job))
        watermark = job.get("watermark")
        if not graph and (operations or isinstance(watermark, dict) and watermark.get("enabled")):
            raise ValueError("Las operaciones no generaron un filtro válido. "
                             "Comprueba que cada región tenga tamaño suficiente y esté dentro del video.")
        trimmed = trim_start > 0 or trim_end is not None
        trim_window = f"start={trim_start:.6f}"
        if trim_end is not None:
            trim_window += f":end={trim_end:.6f}"
        if trimmed:
            trim = f"trim={trim_window},setpts=PTS-STARTPTS[trimmed]"
            graph = f"{graph};{label}{trim}" if graph else f"[0:v]{trim}"
            label = "[trimmed]"
            output_duration = (trim_end if trim_end is not None else duration) - trim_start
        if rate != 1:
            output_duration = cycle_duration(job, duration)
            if not math.isfinite(output_duration) or not 0 < output_duration <= 7200:
                raise ValueError("Retimed output must be between 0 and 7200 seconds")
            fps = float(info.get("frame_rate") or job.get("frame_rate") or 30)
            retime = f"setpts=(PTS-STARTPTS)/{rate:.6f},fps={fps:.6f}[retimed]"
            graph = f"{graph};{label}{retime}" if graph else f"[0:v]{retime}"
            label = "[retimed]"
        codec = info.get("audio_codec") or job.get("audio_codec", "")
        channels = info.get("audio_channels") or job.get("audio_channels")
        audio_af = audio_filter({**job, "audio_codec": codec, "audio_channels": channels})
        audio_filters = [f"atrim={trim_window},asetpts=PTS-STARTPTS"] if trimmed else []
        if audio_af is not None:
            audio_filters.append(audio_af)
        if rate != 1 and codec:
            if not trimmed:
                audio_filters.append("asetpts=PTS-STARTPTS")
            audio_filters += [tempo_filter(rate), f"apad=whole_dur={output_duration:.6f},atrim=duration={output_duration:.6f}"]
        cmd = self._command(job, "info" if duration > 0 else "error")
        for path in image_paths:
            cmd += extra_media_input_args(path, duration=duration, image_fps=1)
        if job.get("external_audio"):
            audio_graph, audio_label, channels, target = self._external_plan(job, len(image_paths) + 1, {**info, **source_info}, external_info)
            cmd += ["-i", job["external_audio"]["path"]]
            graph = f"{graph};{audio_graph}" if graph else audio_graph
        cmd += self.filter_args(self.workers)
        if graph:
            cmd += ["-filter_complex", graph]
        cmd += ["-map", label or "0:v:0"]
        if image_paths:
            cmd += ["-shortest"]
        cmd += ["-pix_fmt", info.get("pix_fmt") or job.get("pix_fmt") or "yuv420p"]
        if job.get("external_audio"):
            cmd += build_audio_args(job["output_path"], "", channels, force_encode=True, audio_map=audio_label)
            cmd += ["-t", f"{target:.6f}"]
        else:
            if audio_filters:
                cmd += ["-af", ",".join(audio_filters)]
            cmd += build_audio_args(job["output_path"], codec, channels, force_encode=trimmed or audio_af is not None or rate != 1)
            if rate != 1:
                cmd += ["-t", f"{output_duration:.6f}"]
        return self._encoding_plan(raw_job, cmd, output_duration, max(600, min(7200, int(duration * 2 + 300))))

    def _encoding_plan(self, job, command, duration, timeout, *, reserve_software=False):
        profile = job.get("encode_profile", "balanced")
        encoder = None
        if not self.retry_job.get("_hw_failed") and profile_allows_hardware(profile):
            encoder = self.hw_encoder if self.ctx or self.hw_encoder is not None else self.detect_encoder(self.ffmpeg_path)
        software_args = self.encode_args(self.ffmpeg_path, profile, job, force_software=True, active_workers=self.workers)
        software_command = command + software_args + self._output_args(job["output_path"])
        hardware_command = command + self.encode_args(self.ffmpeg_path, profile, job,
            hw_encoder=encoder, active_workers=self.workers) + self._output_args(job["output_path"]) if encoder else software_command
        return VideoPlan(job, hardware_command, duration, timeout, encoder, software_command,
                         reserve_software=reserve_software)

    def _run(self, plan, progress_range, *, software=False):
        admission = self.admission if software or plan.reserve_software else None
        if admission is not None and not admission.acquire():
            raise RuntimeError("Cancelled")
        try:
            return self.run_ffmpeg(plan.software_command if software else plan.command,
                timeout_sec=plan.timeout, job_id=plan.job.get("id"), duration_sec=plan.duration, ctx=self.ctx,
                **({"progress_range": progress_range} if progress_range is not None else {}))
        finally:
            if admission is not None:
                admission.release()

    def _execute(self, plan, progress_range):
        job = plan.job
        try:
            self._check_cancelled()
            if plan.native_copy and progress_range is None and self.native_copy_eligible(job["input_path"], job["output_path"], ctx=self.ctx):
                ok, error = self.native_copy(job["input_path"], job["output_path"], ctx=self.ctx, job_id=job.get("id"))
                if ok:
                    logger.info("Job %s: native copy -> %s", job.get("id"), os.path.basename(job["output_path"]))
                    return
                remove_partial_output(job["output_path"], job["input_path"], logger=logger)
                if error == "Cancelled":
                    raise RuntimeError(error)
                logger.warning("Native copy failed, remuxing instead: %s", error)
            ok, error = self._run(plan, progress_range)
            if not ok and plan.encoder and is_hardware_encode_error(error):
                self.retry_job["_hw_failed"] = True
                logger.warning("Job %s: hardware path failed, retrying with libx264", job.get("id"))
                ok, error = self._run(plan, progress_range, software=True)
            if not ok:
                raise RuntimeError(error or "Unknown error")
            logger.info("Job %s: %s -> %s", job.get("id"),
                        "copied" if plan.software_command is None else "completed", os.path.basename(job["output_path"]))
        except Exception:
            remove_partial_output(job["output_path"], job["input_path"], logger=logger)
            raise

    def _render_repeated(self, job, progress_range, force_video_encode):
        info = self._probe(job["input_path"])
        seconds = cycle_duration(job, float(info.get("duration") or 0))
        count = repeat_count(job)
        total = seconds * count
        if not math.isfinite(total) or not 0 < total <= 7200:
            raise ValueError("Repeated output must be between 0 and 7200 seconds")
        with tempfile.TemporaryDirectory(prefix="beru-loop-", dir=self.run_directory) as directory:
            cycle = os.path.join(directory, "cycle" + os.path.splitext(job["output_path"])[1])
            start, end = progress_range or (0, 100)
            middle = start + (end - start) / (count + 1)
            stage = {**job, "repeat_count": 1, "output_path": cycle, "output_root": directory}
            self._render_once(stage, (start, middle), force_video_encode or bool(info.get("source_rotation")))
            self._check_cancelled()
            cycle_info = self._probe(cycle)
            playlist = os.path.join(directory, "cycles.ffconcat")
            with open(playlist, "w", encoding="utf-8") as handle:
                handle.write("ffconcat version 1.0\n")
                handle.write((f"file '{os.path.basename(cycle)}'\nduration {seconds:.9f}\n") * count)
            cmd = [self.ffmpeg_path, "-nostdin", "-xerror", "-y", "-loglevel", "error", "-progress", "pipe:2", "-nostats",
                   "-f", "concat", "-safe", "1", "-i", playlist, "-map", "0:v:0", "-vf", f"fps={float(info.get('frame_rate') or 30):.6f}"]
            if cycle_info.get("audio_codec"):
                cmd += build_audio_args(job["output_path"], "", cycle_info.get("audio_channels"), force_encode=True)
                cmd += ["-af", f"aresample=async=1:first_pts=0,apad=whole_dur={total:.6f},atrim=duration={total:.6f}"]
            else:
                cmd += ["-an"]
            cmd += ["-t", f"{total:.6f}", "-pix_fmt", cycle_info.get("pix_fmt") or "yuv420p"]
            plan = self._encoding_plan(job, cmd, total, 600,
                reserve_software=bool(self.retry_job.get("_hw_failed") and self.hw_encoder))
            self._execute(plan, (middle, end))
