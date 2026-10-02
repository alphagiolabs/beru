"""Processing Run state; context-free helpers retain legacy cancellation defaults."""

import os
import threading
from dataclasses import dataclass, field
from types import MappingProxyType

from capacity import _get_available_ram_mb
from media_probe import find_ffprobe

_cancel_event = threading.Event()
_jobs_file = None


@dataclass
class BatchContext:
    """Run-owned state; retries share it while reducing their worker count."""

    ffmpeg_path: str
    hw_encoder: object = None
    max_workers: int = 1
    sw_fallback_admission: object = None
    jobs_file: object = None
    cancel_event: object = field(default_factory=threading.Event)
    ffprobe_path: object = None
    env: object = field(default_factory=lambda: dict(os.environ))
    progress_times: dict = field(default_factory=dict)
    progress_lock: object = field(default_factory=threading.Lock)

    def __post_init__(self):
        self.env = MappingProxyType(dict(self.env))
        if self.ffprobe_path is None:
            self.ffprobe_path = self.env.get("BERU_FFPROBE") or find_ffprobe(self.ffmpeg_path)


def _check_cancelled(ctx=None):
    """Check if cancellation was requested via sentinel file or event."""
    event = ctx.cancel_event if ctx is not None else _cancel_event
    if event.is_set():
        return True
    jobs_file = ctx.jobs_file if ctx is not None else _jobs_file
    if jobs_file:
        cancel_file = os.path.splitext(jobs_file)[0] + ".cancel"
        if os.path.exists(cancel_file):
            event.set()
            return True
    return False


class _ResourceAdmission:
    def __init__(self, max_workers, per_job_ram_mb, *, ctx=None):
        self.max_workers = max(1, int(max_workers))
        self.per_job_ram_mb = max(0, int(per_job_ram_mb))
        self.active = 0
        self.condition = threading.Condition()
        self.ctx = ctx

    def acquire(self):
        while not _check_cancelled(self.ctx):
            with self.condition:
                available = _get_available_ram_mb()
                memory_ok = (
                    self.active == 0
                    or self.per_job_ram_mb <= 0
                    or available <= 0
                    or available >= self.per_job_ram_mb
                )
                if self.active < self.max_workers and memory_ok:
                    self.active += 1
                    return True
                self.condition.wait(timeout=0.5)
        return False

    def release(self):
        with self.condition:
            self.active = max(0, self.active - 1)
            self.condition.notify_all()
