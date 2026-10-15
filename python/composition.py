"""Ordered clip composition with explicit SDR canvas, cadence and audio."""
import math
import os
import tempfile
import media_probe
from audio_settings import normalize_audio
from job_classify import _job_takes_copy_path
from media_paths import _validated_job_media
from clip_timing import MAX_OUTPUT_DURATION_SECONDS, cycle_duration, repeat_count
from batch_context import _check_cancelled


def process_composition(job, ffmpeg_path, *, ctx, render_clip, run_ffmpeg, encode_args):
    clips = job.get('clips')
    canvas = job.get('canvas') or {}
    width, height, fit = canvas.get('width'), canvas.get('height'), canvas.get('fit')
    fps = float(job.get('composition_fps') or 0)
    if not isinstance(clips, list) or not 2 <= len(clips) <= 50 or any(clip.get('kind') not in (None, 'video') for clip in clips):
        raise ValueError('Composition requires 2–50 video entries')
    if not all(isinstance(n, int) and 16 <= n <= 4096 and n % 2 == 0 for n in (width, height)) or fit not in ('contain', 'cover') or not math.isfinite(fps) or not 1 <= fps <= 120:
        raise ValueError('Invalid composition canvas or FPS')
    job = _validated_job_media(job, require_output=True)
    clips = job['clips']
    if any(os.path.normcase(clip['input_path']) == os.path.normcase(job['output_path']) for clip in clips):
        raise ValueError('Composition output would overwrite a source')
    infos, durations = [], []
    for clip in clips:
        if _check_cancelled(ctx):
            raise RuntimeError('Cancelled')
        info = media_probe.ffprobe(clip['input_path'], ffmpeg_bin=ffmpeg_path,
                                  ffprobe_bin=ctx.ffprobe_path if ctx else media_probe.find_ffprobe(ffmpeg_path))
        if not info.get('width') or not info.get('height') or info.get('color_transfer') in ('smpte2084', 'arib-std-b67'):
            raise ValueError('Composition supports readable SDR video only')
        duration = cycle_duration(clip, float(info.get('duration') or 0)) * repeat_count(clip)
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError('Invalid composition entry duration')
        infos.append(info)
        durations.append(math.ceil(duration * fps - 1e-8) / fps)
    total = sum(durations)
    if total > MAX_OUTPUT_DURATION_SECONDS:
        raise ValueError(f'Composition exceeds {MAX_OUTPUT_DURATION_SECONDS} seconds')
    workers = ctx.max_workers if ctx else 1
    run_directory = os.path.dirname(os.path.abspath(ctx.jobs_file)) if ctx and ctx.jobs_file else None
    os.makedirs(os.path.dirname(job['output_path']) or '.', exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='beru-composition-', dir=run_directory) as directory:
        progress, normalized = 0, []
        for index, (clip, info, duration) in enumerate(zip(clips, infos, durations)):
            start = progress
            progress += 90 * duration / total
            middle = (start + progress) / 2
            source = os.path.join(directory, f'edited-{index}.mkv')
            stage_job = {**clip, 'id': job.get('id', -1), 'output_path': source, 'output_root': directory}
            audio = normalize_audio(clip)
            needs_edit = not _job_takes_copy_path(clip) or clip.get('external_audio') or audio['muted'] or audio['gain'] != 1
            if needs_edit:
                render_clip(stage_job, progress_range=(start, middle), force_video_encode=True)
            else:
                source = clip['input_path']
                middle = start
            if _check_cancelled(ctx):
                raise RuntimeError('Cancelled')
            edited_info = media_probe.ffprobe(source, ffmpeg_bin=ffmpeg_path,
                                            ffprobe_bin=ctx.ffprobe_path if ctx else media_probe.find_ffprobe(ffmpeg_path))
            destination = os.path.join(directory, f'normalized-{index}.mkv')
            aspect = 'decrease' if fit == 'contain' else 'increase'
            frame = f"scale={width}:{height}:force_original_aspect_ratio={aspect}:force_divisible_by=2:reset_sar=1"
            frame += f",pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black" if fit == 'contain' else f",crop={width}:{height}"
            color = 'colorspace=all=bt709'
            if not all(info.get(key) and info[key] != 'unknown' for key in ('color_space', 'color_transfer', 'color_primaries')):
                color += ':iall=bt709'
            color += ':irange=pc' if info.get('color_range') == 'pc' else ':irange=tv'
            frame += f",{color},setsar=1,fps={fps:.6f},tpad=stop_mode=clone:stop_duration={duration:.9f},trim=duration={duration:.9f},setpts=PTS-STARTPTS"
            cmd = [ffmpeg_path, '-nostdin', '-xerror', '-y', '-loglevel', 'error', '-progress', 'pipe:2', '-nostats', '-i', source]
            if not edited_info.get('audio_codec'):
                cmd += ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
            cmd += ['-map', '0:v:0', '-vf', frame, '-map', '0:a:0' if edited_info.get('audio_codec') else '1:a:0',
                    '-af', f'aformat=sample_rates=48000:channel_layouts=stereo,aresample=async=1:first_pts=0,apad=whole_dur={duration:.9f},atrim=duration={duration:.9f}',
                    '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000', '-t', f'{duration:.9f}', '-pix_fmt', 'yuv420p',
                    '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709', '-color_range', 'tv']
            cmd += encode_args(ffmpeg_path, job.get('encode_profile', 'balanced'), job, force_software=True, active_workers=workers)
            cmd.append(destination)
            ok, error = run_ffmpeg(cmd, job_id=job.get('id', -1), duration_sec=duration, ctx=ctx, progress_range=(middle, progress))
            if not ok:
                raise RuntimeError(error)
            normalized.append(os.path.basename(destination))
        playlist = os.path.join(directory, 'composition.ffconcat')
        with open(playlist, 'w', encoding='utf8') as handle:
            handle.write('ffconcat version 1.0\n')
            for filename, duration in zip(normalized, durations):
                handle.write(f"file '{filename}'\nduration {duration:.9f}\n")
        cmd = [ffmpeg_path, '-nostdin', '-xerror', '-y', '-loglevel', 'error', '-progress', 'pipe:2', '-nostats',
               '-f', 'concat', '-safe', '1', '-i', playlist, '-map', '0:v:0', '-c:v', 'copy', '-map', '0:a:0',
               '-af', f'aresample=async=1:first_pts=0,apad=whole_dur={total:.9f},atrim=duration={total:.9f}',
               '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000', '-t', f'{total:.9f}']
        if os.path.splitext(job['output_path'])[1].lower() in ('.mp4', '.mov'):
            cmd += ['-movflags', '+faststart']
        cmd.append(job['output_path'])
        ok, error = run_ffmpeg(cmd, job_id=job.get('id', -1), duration_sec=total, ctx=ctx, progress_range=(90, 100))
        if not ok:
            raise RuntimeError(error)
    return {'index': job.get('id', -1), 'status': 'succeeded'}
