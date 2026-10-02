"""Cropping uses the same display orientation as FFmpeg and preview decoding."""

import subprocess
import struct
import tempfile
from pathlib import Path

import processor
from media_probe import ffprobe as probe


def test_rotated_crop():
    ffmpeg = processor.find_ffmpeg()
    ffprobe = processor.find_ffprobe(ffmpeg)
    with tempfile.TemporaryDirectory(prefix="beru_rotation_") as temp:
        folder = Path(temp)
        source, rotated, output = [folder / name for name in ("source.mp4", "rotated.mp4", "output.mp4")]
        result = subprocess.run([
            ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i",
            "color=c=blue:s=160x90:r=10:d=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
        ], capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr.decode(errors="replace")
        data = bytearray(source.read_bytes())

        def rotate_track(start, end):
            position = start
            while position + 8 <= end:
                size = struct.unpack_from(">I", data, position)[0]
                kind = bytes(data[position + 4:position + 8])
                if size < 8:
                    break
                if kind == b"tkhd":
                    offset = position + 8 + (40 if data[position + 8] == 0 else 52)
                    struct.pack_into(">9i", data, offset, 0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824)
                elif kind in (b"moov", b"trak"):
                    rotate_track(position + 8, position + size)
                position += size

        rotate_track(0, len(data))
        rotated.write_bytes(data)
        info = probe(str(rotated), ffprobe_bin=ffprobe, ffmpeg_bin=ffmpeg)
        assert (info["width"], info["height"]) == (90, 160), info
        fallback = probe(str(rotated), ffprobe_bin="", ffmpeg_bin=ffmpeg)
        assert (fallback["width"], fallback["height"]) == (90, 160), fallback
        result = processor._process_one(0, {
            "input_path": str(rotated), "output_path": str(output),
            "operations": [{"mode": "crop", "region": {"x": 0, "y": 0, "w": 80, "h": 144}}],
            "encode_profile": "fast",
        }, ffmpeg, hw_encoder="")
        assert result["status"] == "succeeded", result
        cropped = probe(str(output), ffprobe_bin=ffprobe, ffmpeg_bin=ffmpeg)
        assert (cropped["width"], cropped["height"]) == (80, 144), cropped


if __name__ == "__main__":
    test_rotated_crop()
    print("Rotated crop passed")
