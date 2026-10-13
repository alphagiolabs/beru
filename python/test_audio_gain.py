#!/usr/bin/env python3
"""Exportable gain and mute through the Processor's CLI, measured on the decoded audio.

Source: 440 Hz stereo tone, 4 s. Gain 0.5 must halve the amplitude (about -6.02 dB) and keep
the frequency and duration; mute must keep the audio track but silence it; a source without
audio must stay without audio. Gain-only jobs must keep the video stream copied.
"""
import array
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from media_probe import find_ffmpeg, find_ffprobe  # noqa: E402

FFMPEG = find_ffmpeg()
FFPROBE = find_ffprobe(FFMPEG)
PROCESSOR = HERE / "processor.py"


def make_source(directory, name, with_audio, channels=2):
    path = str(Path(directory) / name)
    args = [FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x203040:s=320x180:r=30:d=4"]
    if with_audio:
        layout = {1: "mono", 2: "stereo", 6: "5.1"}[channels]
        pan = f"pan={layout}|" + "|".join(f"c{i}=c0" for i in range(channels))
        args += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
                 "-filter_complex", f"[1:a]{pan}[a]", "-map", "0:v", "-map", "[a]",
                 "-c:a", "aac", "-b:a", "128k", "-shortest"]
    else:
        args += ["-an"]
    subprocess.run(args + ["-c:v", "libx264", "-pix_fmt", "yuv420p", path], check=True, timeout=120)
    return path


def probe(path):
    data = json.loads(subprocess.run(
        [FFPROBE, "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        capture_output=True, text=True, check=True).stdout)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    return {
        "width": video["width"], "height": video["height"], "duration": float(data["format"]["duration"]),
        "pix_fmt": video["pix_fmt"], "video_codec": video["codec_name"],
        "audio_codec": audio["codec_name"] if audio else "",
        "audio_channels": int(audio["channels"]) if audio else 0,
    }


def decode_mono(path):
    result = subprocess.run(
        [FFMPEG, "-v", "error", "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", "48000",
         "-af", "aresample=async=1:first_pts=0",
         "-f", "s16le", "-"], capture_output=True, timeout=120)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    samples = array.array("h")
    samples.frombytes(result.stdout)
    return samples


def rms(samples):
    return math.sqrt(sum(s * s for s in samples) / len(samples)) / 32768.0


def zero_crossing_hz(samples, rate=48000):
    crossings = sum(1 for a, b in zip(samples, samples[1:]) if (a < 0) != (b < 0))
    return crossings / 2 / (len(samples) / rate)


def run_processor(directory, source, name, extra):
    info = probe(source)
    job = {
        "input_path": source, "output_path": str(Path(directory) / f"{name}.mp4"),
        "width": info["width"], "height": info["height"],
        "source_width": info["width"], "source_height": info["height"],
        "video_duration": info["duration"], "pix_fmt": info["pix_fmt"],
        "video_codec": info["video_codec"], "audio_codec": info["audio_codec"],
        "audio_channels": info["audio_channels"], "operations": [], "encode_profile": "fast",
        "frame_rate": 30, **extra,
    }
    jobs_file = Path(directory) / f"{name}.json"
    manifest = {"type": "beru-job-manifest", "version": 1, "jobs": [job]}
    jobs_file.write_text(json.dumps(manifest), encoding="utf-8")
    result = subprocess.run([sys.executable, str(PROCESSOR), str(jobs_file)],
                            capture_output=True, text=True, timeout=600)
    assert result.returncode == 0, result.stdout[-600:] + result.stderr[-600:]
    return job["output_path"], result.stdout + result.stderr


def run():
    with tempfile.TemporaryDirectory(prefix="beru-audio-") as directory:
        source = make_source(directory, "tone.mp4", with_audio=True)
        src = decode_mono(source)
        src_rms = rms(src)
        src_hz = zero_crossing_hz(src)

        gained, log = run_processor(directory, source, "gain", {"audio_gain": 0.5, "audio_muted": False})
        assert "copied" in log, "gain-only job must keep the video stream copied"
        out = decode_mono(gained)
        assert abs(rms(out) / src_rms - 0.5) < 0.02, (rms(out), src_rms)
        assert abs(zero_crossing_hz(out) - src_hz) / src_hz < 0.01, (zero_crossing_hz(out), src_hz)
        assert abs(probe(gained)["duration"] - probe(source)["duration"]) < 0.05
        assert probe(gained)["video_codec"] == "h264"
        assert probe(gained)["audio_channels"] == 2
        print(f"stereo gain: RMS ratio={rms(out) / src_rms:.4f}, frequency={zero_crossing_hz(out):.2f} Hz")

        muted, _ = run_processor(directory, source, "mute", {"audio_gain": 1.0, "audio_muted": True})
        assert probe(muted)["audio_codec"], "muted output keeps the audio track"
        assert rms(decode_mono(muted)) < 1e-4

        untouched, log = run_processor(directory, source, "identity", {"audio_gain": 1.0, "audio_muted": False})
        assert abs(rms(decode_mono(untouched)) / src_rms - 1.0) < 0.01

        silent_source = make_source(directory, "silent.mp4", with_audio=False)
        out_path, _ = run_processor(directory, silent_source, "noaudio", {"audio_gain": 0.5, "audio_muted": True})
        assert probe(out_path)["audio_codec"] == "", "a source without audio stays without audio"

        for channels in (1, 6):
            source = make_source(directory, f"tone-{channels}.mp4", with_audio=True, channels=channels)
            gained, _ = run_processor(directory, source, f"gain-{channels}", {"audio_gain": 0.5})
            assert probe(gained)["audio_channels"] == channels, probe(gained)
            ratio = rms(decode_mono(gained)) / rms(decode_mono(source))
            assert abs(ratio - 0.5) < 0.02, ratio
            assert abs(probe(gained)["duration"] - probe(source)["duration"]) < 0.05
            assert abs(zero_crossing_hz(decode_mono(gained)) - zero_crossing_hz(decode_mono(source))) < 5
            print(f"{channels} channels gain: RMS ratio={ratio:.4f}, channels preserved")


if __name__ == "__main__":
    run()
    print("audio gain: all checks passed")
