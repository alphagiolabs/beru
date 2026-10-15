"""Source/output clocks and pitch-preserving retime policy."""
import json
import math
import sys
from pathlib import Path

_DEFAULT_LIMITS = {
    'min_rate': 0.25,
    'max_rate': 4,
    'min_repeat_count': 1,
    'max_repeat_count': 20,
    'max_output_duration_seconds': 7200,
}


def _limits_json_path():
    if getattr(sys, 'frozen', False):
        meipass = Path(getattr(sys, '_MEIPASS', ''))
        for rel in ('resources/processing-limits.json', 'processing-limits.json'):
            candidate = meipass / rel
            if candidate.is_file():
                return candidate
    project_root = Path(__file__).resolve().parent.parent
    for rel in ('resources/processing-limits.json', 'processing-limits.json'):
        candidate = project_root / rel
        if candidate.is_file():
            return candidate
    return None


def _load_limits():
    path = _limits_json_path()
    if path is None:
        return dict(_DEFAULT_LIMITS)
    try:
        with path.open(encoding='utf-8') as handle:
            raw = json.load(handle)
    except (OSError, ValueError):
        return dict(_DEFAULT_LIMITS)
    return {key: raw.get(key, value) for key, value in _DEFAULT_LIMITS.items()}


_LIMITS = _load_limits()

MIN_RATE = _LIMITS['min_rate']
MAX_RATE = _LIMITS['max_rate']
MIN_REPEAT_COUNT = _LIMITS['min_repeat_count']
MAX_REPEAT_COUNT = _LIMITS['max_repeat_count']
MAX_OUTPUT_DURATION_SECONDS = _LIMITS['max_output_duration_seconds']


def playback_rate(job):
    raw = job.get('playback_rate', 1)
    if isinstance(raw, bool):
        return 1.0
    try:
        rate = float(raw)
    except (TypeError, ValueError):
        return 1.0
    return rate if math.isfinite(rate) and MIN_RATE <= rate <= MAX_RATE else 1.0


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
    return int(count) if math.isfinite(count) and count.is_integer() and MIN_REPEAT_COUNT <= count <= MAX_REPEAT_COUNT else 1


def cycle_duration(job, duration):
    start = float(job.get('trim_start') or 0)
    end = job.get('trim_end')
    end = min(float(end), duration) if end is not None else duration
    return (end - start) / playback_rate(job)
