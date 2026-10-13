"""Source/output clocks and pitch-preserving retime policy."""
import math


def playback_rate(job):
    raw = job.get('playback_rate', 1)
    if isinstance(raw, bool):
        return 1.0
    try:
        rate = float(raw)
    except (TypeError, ValueError):
        return 1.0
    return rate if math.isfinite(rate) and .25 <= rate <= 4 else 1.0


def tempo_filter(rate):
    filters = []
    while rate > 2:
        filters.append('atempo=2')
        rate /= 2
    while rate < .5:
        filters.append('atempo=0.5')
        rate /= .5
    if rate != 1:
        filters.append(f'atempo={rate:.6f}')
    return ','.join(filters)


def repeat_count(job):
    raw = job.get('repeat_count', 1)
    if isinstance(raw, bool):
        return 1
    try:
        count = float(raw)
    except (TypeError, ValueError):
        return 1
    return int(count) if math.isfinite(count) and count.is_integer() and 1 <= count <= 20 else 1


def cycle_duration(job, duration):
    start = float(job.get('trim_start') or 0)
    end = job.get('trim_end')
    end = min(float(end), duration) if end is not None else duration
    return (end - start) / playback_rate(job)
