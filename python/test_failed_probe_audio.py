import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

import clip_render
import media_probe
from audio_settings import audio_filter
from batch_context import BatchContext


def _job(**overrides):
    job = {
        "input_path": "C:/videos/demo.mp4",
        "output_path": "C:/videos/out/demo.mp4",
        "width": 640,
        "height": 480,
        "video_duration": 10.0,
        "audio_codec": "aac",
        "audio_channels": 2,
        "audio_muted": True,
        "audio_gain": 0.5,
    }
    job.update(overrides)
    return job


def _renderer():
    ctx = BatchContext(ffmpeg_path="ffmpeg", ffprobe_path="ffprobe")
    return clip_render.ClipRenderer(ctx, hardware_fallback=clip_render.HardwareFallbackState())


def _empty_probe():
    return media_probe._empty_probe_result()


class ProbeHasMediaTest(unittest.TestCase):
    def test_empty_probe_result_has_no_media(self):
        self.assertFalse(clip_render._probe_has_media(_empty_probe()))
        self.assertFalse(clip_render._probe_has_media({}))
        self.assertFalse(clip_render._probe_has_media(None))

    def test_real_probe_has_media(self):
        info = _empty_probe()
        info["width"] = 1920
        self.assertTrue(clip_render._probe_has_media(info))
        by_duration = _empty_probe()
        by_duration["duration"] = 12
        self.assertTrue(clip_render._probe_has_media(by_duration))


class MediaJobAudioPreservationTest(unittest.TestCase):
    def test_failed_probe_preserves_job_audio_metadata(self):
        job = _job()
        with patch.object(media_probe, "ffprobe", return_value=_empty_probe()):
            plan = _renderer()._plan(job, None, False)
        self.assertEqual(plan.job["audio_codec"], "aac")
        self.assertEqual(plan.job["audio_channels"], 2)
        self.assertEqual(audio_filter(plan.job), "volume=0")
        gain_job = _job(audio_muted=False)
        with patch.object(media_probe, "ffprobe", return_value=_empty_probe()):
            plan = _renderer()._plan(gain_job, None, False)
        self.assertEqual(plan.job["audio_codec"], "aac")
        self.assertEqual(plan.job["audio_channels"], 2)
        self.assertEqual(audio_filter(plan.job), "volume=0.5000")

    def test_valid_probe_overrides_job_audio_metadata(self):
        probed = _empty_probe()
        probed.update({"width": 1920, "height": 1080, "duration": 10,
                       "audio_codec": "aac-pro", "audio_channels": 2})
        with patch.object(media_probe, "ffprobe", return_value=probed):
            plan = _renderer()._plan(_job(), None, False)
        self.assertEqual(plan.job["audio_codec"], "aac-pro")
        self.assertEqual(plan.job["audio_channels"], 2)

    def test_failed_probe_does_not_override_encode_branch_info(self):
        base_info = {"width": 640, "height": 480, "duration": 10,
                     "audio_codec": "aac", "audio_channels": 2}
        merged = {**base_info, **(clip_render._probe_has_media(_empty_probe()) and _empty_probe() or {})}
        self.assertEqual(merged["audio_codec"], "aac")
        self.assertEqual(merged["width"], 640)


if __name__ == "__main__":
    unittest.main()
