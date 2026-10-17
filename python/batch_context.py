"""Run inputs and immutable scheduling settings shared by render stages."""

import os
import threading
from dataclasses import dataclass, field
from types import MappingProxyType

from capacity import get_available_ram_mb
from media_probe import find_ffprobe

default_cancel_event = threading.Event()


@dataclass(frozen=True)
class BatchScheduling:
    hw_encoder: object = None
    max_workers: int = 1
    sw_fallback_admission: object = None


@dataclass(frozen=True)
class BatchContext:
    """Run-owned tools, cancellation and telemetry; scheduling is derived per pass."""

    ffmpeg_path: str
    scheduling: BatchScheduling = field(default_factory=BatchScheduling)
    jobs_file: object = None
    cancel_event: object = field(default_factory=threading.Event)
    ffprobe_path: object = None
    env: object = field(default_factory=lambda: dict(os.environ))
    report_progress: object = None

    def __post_init__(self):
        from ffmpeg_runner import create_progress_reporter

        object.__setattr__(self, "env", MappingProxyType(dict(self.env)))
        if self.ffprobe_path is None:
            object.__setattr__(self, "ffprobe_path", self.env.get("BERU_FFPROBE") or find_ffprobe(self.ffmpeg_path))
        if self.report_progress is None:
            object.__setattr__(self, "report_progress", create_progress_reporter())


def check_cancelled(ctx=None):
    """Check if cancellation was requested via sentinel file or event."""
    event = ctx.cancel_event if ctx is not None else default_cancel_event
    if event.is_set():
        return True
    jobs_file = ctx.jobs_file if ctx is not None else None
    if jobs_file:
        cancel_file = os.path.splitext(jobs_file)[0] + ".cancel"
        if os.path.exists(cancel_file):
            event.set()
            return True
    return False


class ResourceAdmission:
    def __init__(self, max_workers, per_job_ram_mb, *, ctx=None):
        self.max_workers = max(1, int(max_workers))
        self.per_job_ram_mb = max(0, int(per_job_ram_mb))
        self.active = 0
        self.condition = threading.Condition()
        self.ctx = ctx

    def acquire(self):
        while not check_cancelled(self.ctx):
            with self.condition:
                if check_cancelled(self.ctx):
                    return False
                available = get_available_ram_mb()
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
