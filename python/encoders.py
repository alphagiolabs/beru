"""Hardware encoder detection through real FFmpeg smoke tests."""

import concurrent.futures
import logging
import subprocess
import threading

from op_shared import _env_flag

logger = logging.getLogger("beru")

_HW_ENCODER_CACHE = None
_HW_ENCODER_CACHE_FOR = None
_HW_ENCODER_LOCK = threading.Lock()


def _test_hw_encoder_real(ffmpeg_path, encoder):
    """Smoke-test the encoder with a tiny 1-frame encode to verify it actually works."""
    test_src = "testsrc=duration=0.1:size=320x240:rate=1"
    preset_args = (
        ["-preset", "p1"] if encoder == "h264_nvenc"
        else ["-preset", "veryfast"] if encoder == "h264_qsv"
        else []
    )
    try:
        result = subprocess.run(
            [
                ffmpeg_path, "-hide_banner", "-f", "lavfi", "-i", test_src,
                "-c:v", encoder, *preset_args, "-frames:v", "1",
                "-f", "null", "-",
            ],
            capture_output=True, text=True, timeout=20,
        )
        if result.returncode == 0:
            return True
        err = (result.stderr or "")[:500]
        logger.info("Encoder %s probe failed: %s", encoder, err)
        return False
    except Exception as e:
        logger.info("Encoder %s probe exception: %s", encoder, e)
        return False


def detect_hw_encoder(ffmpeg_path, *, force_test=False, env=None):
    with _HW_ENCODER_LOCK:
        return _detect_hw_encoder(ffmpeg_path, force_test=force_test, env=env)


def _detect_hw_encoder(ffmpeg_path, *, force_test=False, env=None):
    """Detect first usable hardware H.264 encoder.

    Cached for process lifetime. If force_test is True, also validates the
    encoder with a real 1-frame encode (recommended before a batch run).
    """
    global _HW_ENCODER_CACHE, _HW_ENCODER_CACHE_FOR
    if _HW_ENCODER_CACHE is not None and _HW_ENCODER_CACHE_FOR == ffmpeg_path and not force_test:
        return _HW_ENCODER_CACHE or None
    _HW_ENCODER_CACHE_FOR = ffmpeg_path

    encoders_text = ""
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=15,
        )
        encoders_text = (result.stdout or "") + (result.stderr or "")
    except Exception as e:
        logger.warning("HW encoder detection failed: %s", e)
        _HW_ENCODER_CACHE = ""
        return None

    priority = ["h264_nvenc", "h264_qsv", "h264_mf", "h264_amf"]

    candidates = [enc for enc in priority if enc in encoders_text]

    if not candidates:
        _HW_ENCODER_CACHE = ""
        return None

    if not force_test:
        _HW_ENCODER_CACHE = candidates[0]
        logger.info("Using hardware encoder: %s", candidates[0])
        return candidates[0]

    # Default ON. BERU_HW_PROBE_PARALLEL=0 for GPUs that flake on concurrent 1-frame encodes.
    if _env_flag("BERU_HW_PROBE_PARALLEL", True, env=env) and len(candidates) > 1:
        results = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(candidates)) as pool:
            future_map = {
                pool.submit(_test_hw_encoder_real, ffmpeg_path, enc): enc
                for enc in candidates
            }
            for future in concurrent.futures.as_completed(future_map):
                enc = future_map[future]
                try:
                    results[enc] = future.result()
                except Exception as e:
                    logger.info("Encoder %s probe exception: %s", enc, e)
                    results[enc] = False
        for enc in candidates:
            if results.get(enc):
                _HW_ENCODER_CACHE = enc
                logger.info("Using hardware encoder: %s (verified, parallel)", enc)
                return enc
    else:
        for enc in candidates:
            if _test_hw_encoder_real(ffmpeg_path, enc):
                _HW_ENCODER_CACHE = enc
                logger.info("Using hardware encoder: %s (verified)", enc)
                return enc

    _HW_ENCODER_CACHE = ""
    return None
