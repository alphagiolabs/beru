"""One-shot splitter: processor.py -> phase modules + facade. Run from python/."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
src_lines = (ROOT / "processor.py").read_text(encoding="utf-8").splitlines(keepends=True)


def slice_lines(start: int, end: int) -> str:
    """1-indexed inclusive line slice."""
    return "".join(src_lines[start - 1 : end])


PHASE_DOC = '''\
"""Phase module extracted from processor.py.

Public callables are re-exported by processor.py so the JS/Python test suite can
monkeypatch `processor.X`. Process-wide state and cross-phase callables resolve
via `_P()` late binding.
"""
from __future__ import annotations

'''

COMMON_IMPORTS = '''\
import concurrent.futures
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path


def _P():
    """Late-bound access to the processor module (monkeypatch target).

    When the entrypoint is `python processor.py ...`, the module is registered as
    `__main__` rather than `processor`. Prefer the explicit module name when
    present so imports of `processor` from tests still win.
    """
    mod = sys.modules.get("processor")
    if mod is not None:
        return mod
    return sys.modules["__main__"]


def _log():
    return logging.getLogger("beru")

'''

# Names living on processor that phase modules must access via _P()
PROCESSOR_STATE = {
    "FFMPEG",
    "FFPROBE",
    "_DRAWTEXT_OPTIONS_CACHE",
    "_DRAWTEXT_OPTIONS_CACHE_FOR",
    "_DRAWTEXT_CACHE",
    "_DRAWTEXT_CACHE_LOCK",
    "_DRAWTEXT_CACHE_ENABLED",
    "_BATCH_ACTIVE_WORKERS",
    "_cancel_event",
    "_jobs_file",
    "_last_job_progress_emit",  # used from process_jobs; lives in batch module in prior attempt
}

# Re-exported callables that must be late-bound when called from phase code
LATE_CALLABLES = {
    # probe
    "job_video_info",
    "find_ffmpeg",
    "find_ffprobe",
    "_safe_float",
    "_safe_int",
    "_parse_frame_rate",
    "_empty_probe_result",
    "_parse_channel_layout",
    "_ffprobe_via_ffmpeg",
    "ffprobe",
    # encode
    "_test_hw_encoder_real",
    "detect_hw_encoder",
    "build_hwaccel_args",
    "build_filter_thread_args",
    "resolve_x264_threads",
    "build_audio_args",
    "build_encode_args",
    "_get_available_ram_mb",
    "_memory_cap_workers",
    "resolve_max_workers",
    # filter_graph
    "_get_drawtext_options",
    "_drawtext_supports",
    "_validate_drawtext_text",
    "_escape_drawtext_text",
    "_drawtext_cache_enabled",
    "build_drawtext",
    "_build_watermark_filter",
    "build_filter_complex",
    # batch
    "_safe_print",
    "_check_cancelled",
    "_is_transient_error",
    "_is_hardware_encode_error",
    "_is_resource_pressure_error",
    "_retry_failed_enabled",
    "_should_retry_failed_job",
    "_extract_error_line",
    "_remove_partial_output",
    "_output_path_from_ffmpeg_cmd",
    "_input_path_from_ffmpeg_cmd",
    "_cleanup_ffmpeg_partial",
    "_should_retry_ffmpeg",
    "_format_processing_error",
    "_job_failed_result",
    "_job_cancelled_result",
    "_emit_job_progress",
    "_kill_ffmpeg_process",
    "_run_ffmpeg_stream",
    "_run_ffmpeg",
    "_process_one",
    "_execute_batch",
    "process_jobs",
    # processor-owned (fonts, validation, etc.)
    "get_system_fonts",
    "_resolve_font",
    "_validated_job_media",
    "validate_media_path",
}

# Combined set of names to rewrite as _P().name (word-boundary, not string literals)
P_NAMES = PROCESSOR_STATE | LATE_CALLABLES


def rewrite_body(text: str, *, extra_local: set[str] | None = None) -> str:
    """Rewrite processor-bound names to _P().name and logger to _log()."""
    local = set(extra_local or ())

    # logger.foo -> _log().foo  (but not logger = ...)
    text = re.sub(r"\blogger\.", "_log().", text)

    # global declarations that only referenced processor state: drop or slim
    def fix_global(m):
        names = [n.strip() for n in m.group(1).split(",")]
        keep = [n for n in names if n not in P_NAMES and n not in local]
        # Also drop names that are truly local to the phase module (handled by caller)
        if not keep:
            return ""  # remove bare global line
        return "global " + ", ".join(keep)

    text = re.sub(r"^([ \t]*)global ([^\n]+)\n", lambda m: (m.group(1) + fix_global(type("M", (), {"group": lambda s, i: m.group(i + 1) if i else m.group(0)})()) + "\n") if fix_global(type("M", (), {"group": lambda s, i: m.group(2) if i == 1 else m.group(0)})()) else "", text, flags=re.M)

    # Simpler global fix:
    lines = text.splitlines(keepends=True)
    out = []
    for line in lines:
        gm = re.match(r"^([ \t]*)global ([^\n#]+)([ \t]*(?:#.*)?\n?)$", line)
        if gm:
            indent, names_s, rest = gm.group(1), gm.group(2), gm.group(3)
            names = [n.strip() for n in names_s.split(",")]
            # Names accessed via _P() should not be global in phase modules
            keep = [n for n in names if n not in P_NAMES]
            # _HW_ENCODER_CACHE stays local global in encode
            if not keep:
                continue
            out.append(f"{indent}global {', '.join(keep)}{rest if rest.endswith(chr(10)) else rest + chr(10)}")
            continue
        out.append(line)
    text = "".join(out)

    # Rewrite bare name references to _P().name
    # Avoid matching inside strings by a simple tokenizer
    def transform_code(code: str) -> str:
        # Sort longer names first to avoid partial matches
        names = sorted(P_NAMES, key=len, reverse=True)
        # Pattern: not preceded by . or word char or quote context — use word boundary
        # Skip if already _P().NAME
        for name in names:
            if name in local:
                continue
            pattern = rf"(?<![\w.]){re.escape(name)}(?![\w])"
            # Don't rewrite if already after _P().
            def repl(m, n=name):
                start = m.start()
                before = code[max(0, start - 4) : start]
                if before.endswith("_P()."):
                    return m.group(0)
                # Don't rewrite attribute assignment targets that are already rewritten
                return f"_P().{n}"

            code = re.sub(pattern, repl, code)
        return code

    # Protect string/f-string contents from rewrites of ffprobe/ffmpeg function names.
    # Strategy: split on string literals, only rewrite non-string parts.
    # This is imperfect for nested f-strings but works for this codebase.
    parts = []
    i = 0
    n = len(text)
    while i < n:
        # triple quotes
        if text.startswith('"""', i) or text.startswith("'''", i):
            q = text[i : i + 3]
            j = text.find(q, i + 3)
            if j < 0:
                parts.append(("s", text[i:]))
                break
            parts.append(("s", text[i : j + 3]))
            i = j + 3
            continue
        if text[i] in ("'", '"'):
            q = text[i]
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == q:
                    j += 1
                    break
                j += 1
            parts.append(("s", text[i:j]))
            i = j
            continue
        # f-string prefix
        if text[i] in ("f", "F", "r", "R", "b", "B") and i + 1 < n and text[i + 1] in ("'", '"'):
            # include prefix in string part
            pass
        # code run until next quote
        j = i
        while j < n and text[j] not in ("'", '"'):
            # check for triple at j
            if text.startswith('"""', j) or text.startswith("'''", j):
                break
            j += 1
        # handle f/r prefixes at end of code segment
        if j > i and j < n and text[j] in ("'", '"') and text[j - 1] in "fFrRbBuU":
            # walk back over prefixes
            k = j - 1
            while k >= i and text[k] in "fFrRbBuU":
                k -= 1
            if k + 1 < j:
                parts.append(("c", text[i : k + 1]))
                # string starts at k+1
                i = k + 1
                continue
        parts.append(("c", text[i:j]))
        i = j

    rebuilt = []
    for kind, chunk in parts:
        if kind == "s":
            rebuilt.append(chunk)
        else:
            rebuilt.append(transform_code(chunk))
    return "".join(rebuilt)


def write_probe():
    body = []
    # constants + functions
    chunks = [
        slice_lines(839, 860),   # job_video_info
        slice_lines(863, 884),   # find_ffmpeg
        slice_lines(887, 909),   # find_ffprobe
        slice_lines(912, 924),   # _safe_float
        slice_lines(927, 932),   # _safe_int
        slice_lines(935, 945),   # _parse_frame_rate
        slice_lines(948, 951),   # _empty_probe_result
        slice_lines(954, 964),   # _CHANNEL_LAYOUT_TO_COUNT
        slice_lines(967, 984),   # _parse_channel_layout
        slice_lines(987, 1044),  # _ffprobe_via_ffmpeg
        slice_lines(1047, 1094), # ffprobe
    ]
    raw = "\n".join(c.rstrip() + "\n" for c in chunks)
    # _CHANNEL_LAYOUT_TO_COUNT is local const — not in P_NAMES
    body_text = rewrite_body(raw)
    text = PHASE_DOC + COMMON_IMPORTS + "\n" + body_text
    (ROOT / "probe.py").write_text(text, encoding="utf-8")
    print("wrote probe.py", len(text.splitlines()), "lines")


def write_encode():
    chunks = [
        slice_lines(421, 427),   # _AUDIO_COPY_CODECS
        # _HW_ENCODER_CACHE local to encode
        "_HW_ENCODER_CACHE = None\n\n",
        slice_lines(434, 458),   # _test_hw_encoder_real
        slice_lines(461, 531),   # detect_hw_encoder
        slice_lines(534, 538),   # build_hwaccel_args
        slice_lines(567, 587),   # MAX_WORKERS_CAP, AUTO_TARGET, _ENCODER_CAPS
        # skip _BATCH_ACTIVE_WORKERS — lives on processor
        slice_lines(596, 601),   # build_filter_thread_args
        slice_lines(604, 608),   # resolve_x264_threads
        slice_lines(611, 625),   # build_audio_args
        slice_lines(628, 684),   # build_encode_args
        slice_lines(687, 716),   # _get_available_ram_mb
        slice_lines(721, 729),   # _RAM_PER_JOB_MB
        slice_lines(732, 766),   # _memory_cap_workers
        slice_lines(769, 836),   # resolve_max_workers
    ]
    raw = "\n".join(
        (c if isinstance(c, str) and not c.startswith("def") and "\n" in c and not c.strip().startswith("def") else (c.rstrip() + "\n" if not isinstance(c, str) else c))
        if False else (c if c.endswith("\n") else c + "\n")
        for c in chunks
    )
    # Fix join properly
    parts = []
    for c in chunks:
        if isinstance(c, str):
            parts.append(c if c.endswith("\n") else c + "\n")
    raw = "\n".join(p.rstrip("\n") for p in parts) + "\n"
    # Local globals that should NOT go through _P
    local = {"_HW_ENCODER_CACHE", "_AUDIO_COPY_CODECS", "MAX_WORKERS_CAP", "AUTO_TARGET_WORKERS", "_ENCODER_CAPS", "_RAM_PER_JOB_MB"}
    # Temporarily remove local names from rewrite
    body_text = rewrite_body(raw)
    # Fix over-rewrites of local module globals that got _P().
    for name in ("_HW_ENCODER_CACHE", "_AUDIO_COPY_CODECS", "MAX_WORKERS_CAP", "AUTO_TARGET_WORKERS", "_ENCODER_CAPS", "_RAM_PER_JOB_MB"):
        body_text = body_text.replace(f"_P().{name}", name)

    # detect_hw_encoder uses global _HW_ENCODER_CACHE — ensure global statement present
    if "global _HW_ENCODER_CACHE" not in body_text:
        body_text = body_text.replace(
            "def detect_hw_encoder(ffmpeg_path, *, force_test=False):",
            "def detect_hw_encoder(ffmpeg_path, *, force_test=False):\n    global _HW_ENCODER_CACHE",
        )
        # better: insert after docstring
        body_text = re.sub(
            r"(def detect_hw_encoder\(ffmpeg_path, \*, force_test=False\):\n)(    \"\"\"[\s\S]*?\"\"\"\n)",
            r"\1\2    global _HW_ENCODER_CACHE\n",
            body_text,
            count=1,
        )

    header = PHASE_DOC + COMMON_IMPORTS + '''\
from encode_profiles import (
    ENCODE_PROFILES,
    effective_hw_encoder as resolve_effective_hw_encoder,
    profile_allows_hardware,
)

'''
    text = header + body_text
    (ROOT / "encode.py").write_text(text, encoding="utf-8")
    print("wrote encode.py", len(text.splitlines()), "lines")


def write_filter_graph():
    chunks = [
        slice_lines(541, 560),    # _get_drawtext_options
        slice_lines(563, 564),    # _drawtext_supports
        slice_lines(1101, 1103),  # _ALLOWED_DRAWTEXT_PUNCTUATION
        slice_lines(1104, 1109),  # _validate_drawtext_text
        slice_lines(1112, 1125),  # _escape_drawtext_text
        slice_lines(1128, 1135),  # _drawtext_cache_enabled
        slice_lines(1138, 1325),  # build_drawtext
        slice_lines(1328, 1401),  # _build_watermark_filter
        slice_lines(1404, 1571),  # build_filter_complex
    ]
    parts = [c.rstrip() + "\n" for c in chunks]
    raw = "\n".join(p.rstrip("\n") for p in parts) + "\n"
    body_text = rewrite_body(raw)
    # Local const
    body_text = body_text.replace("_P()._ALLOWED_DRAWTEXT_PUNCTUATION", "_ALLOWED_DRAWTEXT_PUNCTUATION")

    header = PHASE_DOC + COMMON_IMPORTS + '''\
from op_shared import (
    _build_enable_clause,
    _coerce_float,
    _coerce_int,
    _is_op_time_disabled,
    _normalize_operation,
    _region_to_pixels,
)
from color_validation import _validate_drawtext_color
from delogo_chains import _build_delogo_chain
from text_layout_helpers import (
    _apply_letter_spacing_fallback,
    _build_region_bg_drawbox,
    _fit_font_size,
    _text_bg_enabled,
    _text_box_pad,
    _text_layout_bounds,
    _truncate_text,
    _wrap_text_to_width,
)

'''
    text = header + body_text
    (ROOT / "filter_graph.py").write_text(text, encoding="utf-8")
    print("wrote filter_graph.py", len(text.splitlines()), "lines")


def write_batch():
    chunks = [
        slice_lines(1574, 1577),  # MAX_RETRIES etc
        # local progress locks (not cancelled — those stay on processor)
        "_tr_print_lock = threading.Lock()\n",
        "_last_job_progress_emit = {}\n",
        "_job_progress_lock = threading.Lock()\n",
        # skip _cancel_event, _jobs_file
        slice_lines(1583, 1584),  # regexes
        slice_lines(1587, 2316),  # all batch functions through process_jobs
    ]
    parts = []
    for c in chunks:
        parts.append(c if c.endswith("\n") else c + "\n")
    raw = "".join(parts)
    # Local names
    body_text = rewrite_body(raw)
    for name in (
        "MAX_RETRIES",
        "RETRY_DELAYS",
        "MAX_STDERR_LINES",
        "MAX_STDERR_CHARS",
        "_tr_print_lock",
        "_last_job_progress_emit",
        "_job_progress_lock",
        "_FFMPEG_TIME_RE",
        "_FFMPEG_SPEED_RE",
        "StderrBuffer",
    ):
        body_text = body_text.replace(f"_P().{name}", name)

    # StderrBuffer references MAX_STDERR_* as defaults — fine as local

    header = PHASE_DOC + COMMON_IMPORTS + '''\
from batch_errors import (
    format_processing_error,
    is_hardware_encode_error,
    is_resource_pressure_error,
    remove_partial_output,
)
from encode_profiles import (
    effective_hw_encoder as resolve_effective_hw_encoder,
    profile_allows_hardware,
)
from op_shared import (
    _normalize_operation,
    _optimize_delogo_for_speed,
)

'''
    text = header + body_text
    (ROOT / "batch_orchestrator.py").write_text(text, encoding="utf-8")
    print("wrote batch_orchestrator.py", len(text.splitlines()), "lines")


def write_processor_facade():
    # Keep: header, imports of pure modules, constants, path validation, fonts,
    # logging, mutable state, re-exports from phases, CLI
    header = '''\
#!/usr/bin/env python3
"""
Beru Video Processor
Reads a JSON job manifest and processes videos with:
  - Text overlay (via drawtext filter)
  - Blur regions (via boxblur + crop overlay)
  - Crop regions
  - Delogo (inpaint / blur / color fill)
Outputs progress as JSON lines to stdout.

Implementation is split across phase modules (probe, encode, filter_graph,
batch_orchestrator). This module is the public facade: fonts, path validation,
logging, mutable process state, re-exports, and CLI.
"""

import base64
import json
import re
import platform
import logging
import logging.handlers
import subprocess
import sys
import os
import shutil
import time
import threading
from pathlib import Path

from encode_profiles import (
    ENCODE_PROFILES,
    effective_hw_encoder as resolve_effective_hw_encoder,
    profile_allows_hardware,
)
from batch_errors import (
    format_processing_error,
    is_hardware_encode_error,
    is_resource_pressure_error,
    remove_partial_output,
)

# Pure helpers extracted into sibling modules (kept stateless & un-patched so
# they are safe outside this module's single namespace — the JS test suite
# monkeypatches processor.X heavily, so anything callable through a patched
# name MUST stay reachable on this module).  Re-exported below for the Python
# smoke tests.
from op_shared import (
    VALID_DELOGO_METHODS,
    _build_enable_clause,
    _coerce_float,
    _coerce_int,
    _is_op_time_disabled,
    _normalize_operation,
    _optimize_delogo_for_speed,
    _overlay_opts,
    _region_to_pixels,
)
from color_validation import _validate_drawtext_color
from delogo_chains import (
    _build_cleanup_filter,
    _build_delogo_chain,
    _build_mirror_patch,
    _build_padded_region,
    _fit_delogo_rect,
)
from text_layout_helpers import (
    _apply_letter_spacing_fallback,
    _build_region_bg_drawbox,
    _estimate_char_width,
    _fit_font_size,
    _text_bg_enabled,
    _text_box_pad,
    _text_clusters,
    _text_layout_bounds,
    _truncate_text,
    _wrap_text_to_width,
)

FFMPEG = os.environ.get("BERU_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("BERU_FFPROBE", "ffprobe")
JOB_MANIFEST_TYPE = "beru-job-manifest"
JOB_MANIFEST_VERSION = 1

VIDEO_INPUT_EXTENSIONS = frozenset(
    {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg"}
)
VIDEO_OUTPUT_EXTENSIONS = frozenset({".mp4", ".mov", ".avi", ".mkv", ".webm"})
IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"})
FONT_EXTENSIONS = frozenset({".ttf", ".otf", ".ttc"})

'''
    # Path validation + fonts + logging from original
    middle = slice_lines(89, 418)  # validate_media_path through logger = setup_logging()

    state = '''\

# Mutable caches / batch state — must live on this module so JS tests can assign
# processor.X and late-bound phase code (_P().X) observes the same objects.
_DRAWTEXT_OPTIONS_CACHE = None
_DRAWTEXT_OPTIONS_CACHE_FOR = None
_DRAWTEXT_CACHE = {}
_DRAWTEXT_CACHE_LOCK = threading.Lock()
_DRAWTEXT_CACHE_ENABLED = None
_BATCH_ACTIVE_WORKERS = 1
_cancel_event = threading.Event()
_jobs_file = None

# Phase modules (late-bound callables re-exported for monkeypatch compatibility)
from probe import (  # noqa: E402
    _CHANNEL_LAYOUT_TO_COUNT,
    _empty_probe_result,
    _ffprobe_via_ffmpeg,
    _parse_channel_layout,
    _parse_frame_rate,
    _safe_float,
    _safe_int,
    ffprobe,
    find_ffmpeg,
    find_ffprobe,
    job_video_info,
)
from encode import (  # noqa: E402
    AUTO_TARGET_WORKERS,
    MAX_WORKERS_CAP,
    _AUDIO_COPY_CODECS,
    _ENCODER_CAPS,
    _HW_ENCODER_CACHE,
    _RAM_PER_JOB_MB,
    _get_available_ram_mb,
    _memory_cap_workers,
    _test_hw_encoder_real,
    build_audio_args,
    build_encode_args,
    build_filter_thread_args,
    build_hwaccel_args,
    detect_hw_encoder,
    resolve_max_workers,
    resolve_x264_threads,
)
from filter_graph import (  # noqa: E402
    _ALLOWED_DRAWTEXT_PUNCTUATION,
    _build_watermark_filter,
    _drawtext_cache_enabled,
    _drawtext_supports,
    _escape_drawtext_text,
    _get_drawtext_options,
    _validate_drawtext_text,
    build_drawtext,
    build_filter_complex,
)
from batch_orchestrator import (  # noqa: E402
    MAX_RETRIES,
    MAX_STDERR_CHARS,
    MAX_STDERR_LINES,
    RETRY_DELAYS,
    StderrBuffer,
    _FFMPEG_SPEED_RE,
    _FFMPEG_TIME_RE,
    _check_cancelled,
    _cleanup_ffmpeg_partial,
    _emit_job_progress,
    _execute_batch,
    _extract_error_line,
    _format_processing_error,
    _input_path_from_ffmpeg_cmd,
    _is_hardware_encode_error,
    _is_resource_pressure_error,
    _is_transient_error,
    _job_cancelled_result,
    _job_failed_result,
    _job_progress_lock,
    _kill_ffmpeg_process,
    _last_job_progress_emit,
    _output_path_from_ffmpeg_cmd,
    _process_one,
    _remove_partial_output,
    _retry_failed_enabled,
    _run_ffmpeg,
    _run_ffmpeg_stream,
    _safe_print,
    _should_retry_failed_job,
    _should_retry_ffmpeg,
    _tr_print_lock,
    process_jobs,
)

'''
    cli = slice_lines(2319, 2519)  # _init_ffmpeg_globals through __main__

    text = header + middle + state + "\n" + cli
    # Ensure trailing newline
    if not text.endswith("\n"):
        text += "\n"
    (ROOT / "processor.py").write_text(text, encoding="utf-8")
    print("wrote processor.py", len(text.splitlines()), "lines")


if __name__ == "__main__":
    write_probe()
    write_encode()
    write_filter_graph()
    write_batch()
    write_processor_facade()
    print("done")
