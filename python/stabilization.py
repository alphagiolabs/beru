"""Derived stabilized media: vidstab detection then transform, original untouched."""
import math
import os
import tempfile
import media_probe
from media_paths import _validated_job_media
from batch_context import _check_cancelled

SMOOTHING = {'low': 10, 'medium': 20, 'high': 30}
COPYABLE_AUDIO = ('aac', 'mp3', 'ac3', 'eac3', 'alac')
MAX_SOURCE_SECONDS = 7200
MAX_SAMPLE_SECONDS = 60


def stabilization_settings(job):
    settings = job.get('stabilization')
    if not isinstance(settings, dict) or settings.get('intensity') not in SMOOTHING or settings.get('edges') not in ('zoom', 'keep'):
        raise ValueError('Invalid stabilization settings')
    sample = job.get('sample_seconds')
    if sample is not None and (isinstance(sample, bool) or not isinstance(sample, (int, float)) or not 1 <= sample <= MAX_SAMPLE_SECONDS):
        raise ValueError('Invalid stabilization sample length')
    return settings['intensity'], settings['edges'], sample


def _filter_path(path):
    """Escape a path for an FFmpeg filter option: once for the option parser, once for the graph parser."""
    text = os.path.abspath(path).replace('\\', '/')
    text = ''.join('\\' + char if char in "':" else char for char in text)
    return ''.join('\\' + char if char in "\\'[],;" else char for char in text)


def process_stabilization(job, ffmpeg_path, *, ctx, run_ffmpeg, encode_args):
    intensity, edges, sample = stabilization_settings(job)
    job = _validated_job_media(job, require_output=True)
    if os.path.normcase(job['input_path']) == os.path.normcase(job['output_path']):
        raise ValueError('Stabilization output would overwrite its source')
    if _check_cancelled(ctx):
        raise RuntimeError('Cancelled')
    info = media_probe.ffprobe(job['input_path'], ffmpeg_bin=ffmpeg_path,
                              ffprobe_bin=ctx.ffprobe_path if ctx else media_probe.find_ffprobe(ffmpeg_path))
    if not info.get('width') or not info.get('height') or info.get('color_transfer') in ('smpte2084', 'arib-std-b67'):
        raise ValueError('Stabilization supports readable SDR video only')
    duration = float(info.get('duration') or 0)
    if sample is not None:
        duration = min(duration, float(sample))
    if not math.isfinite(duration) or duration <= 0 or duration > MAX_SOURCE_SECONDS:
        raise ValueError('Invalid stabilization duration')
    workers = ctx.max_workers if ctx else 1
    run_directory = os.path.dirname(os.path.abspath(ctx.jobs_file)) if ctx and ctx.jobs_file else None
    os.makedirs(os.path.dirname(job['output_path']) or '.', exist_ok=True)
    limit = ['-t', f'{duration:.6f}'] if sample is not None else []
    with tempfile.TemporaryDirectory(prefix='beru-stabilization-', dir=run_directory) as directory:
        transforms = os.path.join(directory, 'motion.trf')
        detect = [ffmpeg_path, '-nostdin', '-xerror', '-y', '-loglevel', 'error', '-progress', 'pipe:2', '-nostats',
                  '-i', job['input_path'], *limit, '-an', '-vf', f'vidstabdetect=shakiness=5:accuracy=15:result={_filter_path(transforms)}',
                  '-f', 'null', '-']
        ok, error = run_ffmpeg(detect, job_id=job.get('id', -1), duration_sec=duration, ctx=ctx, progress_range=(0, 40))
        if not ok:
            raise RuntimeError(error)
        if _check_cancelled(ctx):
            raise RuntimeError('Cancelled')
        zoom = 'optzoom=1:zoomspeed=0.25' if edges == 'zoom' else 'optzoom=0:zoom=0:crop=black'
        transform = f'vidstabtransform=input={_filter_path(transforms)}:smoothing={SMOOTHING[intensity]}:{zoom}:interpol=bicubic'
        audio = ['-c:a', 'copy'] if info.get('audio_codec') in COPYABLE_AUDIO else ['-c:a', 'aac', '-b:a', '192k']
        cmd = [ffmpeg_path, '-nostdin', '-xerror', '-y', '-loglevel', 'error', '-progress', 'pipe:2', '-nostats',
               '-i', job['input_path'], *limit, '-map', '0:v:0', '-map', '0:a:0?', '-vf', transform, *audio,
               '-pix_fmt', 'yuv420p']
        cmd += encode_args(ffmpeg_path, job.get('encode_profile', 'balanced'), job, force_software=True, active_workers=workers)
        if os.path.splitext(job['output_path'])[1].lower() in ('.mp4', '.mov'):
            cmd += ['-movflags', '+faststart']
        cmd.append(job['output_path'])
        ok, error = run_ffmpeg(cmd, job_id=job.get('id', -1), duration_sec=duration, ctx=ctx, progress_range=(40, 100))
        if not ok:
            raise RuntimeError(error)
    return {'index': job.get('id', -1), 'status': 'succeeded'}
