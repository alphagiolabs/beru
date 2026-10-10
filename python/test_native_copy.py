"""Byte integrity and cancellation across native-copy buffer boundaries."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ffmpeg_runner
from batch_context import BatchContext


class NativeCopyTests(unittest.TestCase):
    def test_empty_small_and_partial_final_block_preserve_bytes(self):
        payloads = (
            b"",
            b"small file",
            b"A" * (8 * 1024 * 1024) + b"B" * (8 * 1024 * 1024) + b"final block",
        )
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mp4"
            output = Path(directory) / "output.mp4"
            for payload in payloads:
                with self.subTest(size=len(payload)):
                    source.write_bytes(payload)
                    with patch.object(ffmpeg_runner, "_emit_job_progress") as progress:
                        result = ffmpeg_runner._native_stream_copy(source, output, job_id=7)
                    self.assertEqual(result, (True, None))
                    self.assertEqual(output.read_bytes(), payload)
                    self.assertEqual(source.read_bytes(), payload)
                    self.assertEqual(progress.call_args.args[:2], (7, 100))

    def test_cancellation_between_blocks_does_not_report_completion(self):
        first_block = b"A" * (8 * 1024 * 1024)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mp4"
            output = Path(directory) / "output.mp4"
            source.write_bytes(first_block + b"B" * len(first_block) + b"tail")
            ctx = BatchContext(ffmpeg_path="unused")
            percentages = []

            def cancel_after_progress(job_id, percent, speed, **kwargs):
                percentages.append(percent)
                ctx.cancel_event.set()

            with patch.object(ffmpeg_runner, "_emit_job_progress", side_effect=cancel_after_progress):
                result = ffmpeg_runner._native_stream_copy(source, output, ctx=ctx, job_id=7)
            self.assertEqual(result, (False, "Cancelled"))
            self.assertEqual(output.read_bytes(), first_block)
            self.assertTrue(percentages)
            self.assertTrue(all(percent < 100 for percent in percentages))


if __name__ == "__main__":
    unittest.main()
