import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import media_probe


class ProbeCacheTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="beru-probe-cache-")
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        (self.directory / "subdir").mkdir()
        self.source = self.directory / "clip.mp4"
        self.source.write_bytes(b"video")
        self.probe_bin = self.directory / "ffprobe.exe"
        self.probe_bin.touch()
        payload = {
            "streams": [{"codec_type": "video", "codec_name": "h264",
                         "width": 640, "height": 480, "r_frame_rate": "30/1"}],
            "format": {"duration": "12"},
        }
        completed = subprocess.CompletedProcess([], 0, json.dumps(payload), "")
        runner = patch.object(media_probe.subprocess, "run", return_value=completed)
        self.run_probe = runner.start()
        self.addCleanup(runner.stop)
        cache = patch.object(media_probe, "_PROBE_CACHE", {})
        cache.start()
        self.addCleanup(cache.stop)

    def probe(self, source=None, **kwargs):
        return media_probe.ffprobe_cached(
            self.source if source is None else source,
            ffprobe_bin=kwargs.pop("ffprobe_bin", self.probe_bin), **kwargs,
        )

    def test_unchanged_file_reuses_the_probe(self):
        first = self.probe()
        second = self.probe(self.directory / "subdir" / ".." / "clip.mp4")
        self.assertEqual((first["width"], first["height"], first["duration"]), (640, 480, 12))
        self.assertEqual(second, first)
        self.assertEqual(self.run_probe.call_count, 1)

    def test_size_change_invalidates_even_with_the_same_mtime(self):
        self.probe()
        stat = self.source.stat()
        self.source.write_bytes(b"longer video")
        os.utime(self.source, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        self.probe()
        self.assertEqual(self.run_probe.call_count, 2)

    def test_mtime_change_invalidates_even_with_the_same_size(self):
        self.probe()
        stat = self.source.stat()
        os.utime(self.source, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
        self.probe()
        self.assertEqual(self.run_probe.call_count, 2)

    def test_callers_cannot_mutate_cached_metadata(self):
        first = self.probe()
        first["audio_codec"] = "modified"
        adjusted = media_probe.job_video_info(
            {"width": 320, "height": 240, "video_info_probed": False},
            self.source, probe_fn=self.probe,
        )
        self.assertEqual((adjusted["width"], adjusted["height"]), (320, 240))
        second = self.probe()
        self.assertEqual((second["width"], second["height"], second["audio_codec"]), (640, 480, ""))
        second["width"] = 100
        self.assertEqual(self.probe()["width"], 640)
        self.assertEqual(self.run_probe.call_count, 1)

    def test_oldest_entry_is_evicted_after_128_files(self):
        self.probe()
        for index in range(128):
            source = self.directory / f"clip-{index}.mp4"
            source.write_bytes(b"video")
            self.probe(source)
        self.probe()
        self.assertEqual(self.run_probe.call_count, 130)

    def test_failed_probe_can_be_retried_without_a_file_change(self):
        failed = subprocess.CompletedProcess([], 0, json.dumps({
            "streams": [{"codec_type": "video", "width": 0, "height": 0}],
        }), "")
        self.run_probe.side_effect = [failed, self.run_probe.return_value]
        self.assertEqual(self.probe()["width"], 0)
        self.assertEqual(self.probe()["width"], 640)
        self.assertEqual(self.probe()["width"], 640)
        self.assertEqual(self.run_probe.call_count, 2)

    def test_different_binaries_do_not_share_results(self):
        self.probe()
        alternative = self.directory / "alternate-ffprobe.exe"
        alternative.touch()
        self.probe(ffprobe_bin=alternative)
        self.probe(ffmpeg_bin="alternate-ffmpeg.exe")
        self.assertEqual(self.run_probe.call_count, 3)


if __name__ == "__main__":
    unittest.main()
