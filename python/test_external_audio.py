"""External audio through the real Processor: timing, composition and video identity."""
import math
import tempfile
import subprocess
from pathlib import Path
import test_audio_gain as audio


def amplitude(samples, frequency, start, end):
    segment = samples[int(start * 48000):int(end * 48000)]
    n = len(segment)
    assert n > 0
    real = sum(x * math.cos(2 * math.pi * frequency * i / 48000) for i, x in enumerate(segment))
    imag = sum(x * math.sin(2 * math.pi * frequency * i / 48000) for i, x in enumerate(segment))
    return 2 * math.hypot(real, imag) / n


def run():
    with tempfile.TemporaryDirectory(prefix="beru-added-audio-") as directory:
        root = Path(directory)
        source = audio.make_source(root, "source.mp4", True)
        silent = audio.make_source(root, "silent.mp4", False)
        music = str(root / "music.wav")
        subprocess.run([audio.FFMPEG,"-v","error","-f","lavfi","-i",
                        "sine=frequency=880:sample_rate=48000:duration=3",music],check=True,timeout=30)
        original = audio.decode_mono(source)
        asset = {"path":music,"mode":"mix","offset":1,"trim_start":0.5,"trim_end":1.5,"gain":1}
        extra = {"external_audio":asset,"asset_roots":[str(root)]}
        mixed, _ = audio.run_processor(root, source, "mix", extra)
        def video_hash(path):
            return subprocess.run([audio.FFMPEG,"-v","error","-i",path,"-map","0:v:0",
                                   "-c:v","copy","-f","hash","-"],
                                  capture_output=True,text=True,check=True,timeout=30).stdout.strip()
        assert video_hash(mixed) == video_hash(source), "Adding audio must preserve identity video packets"
        samples = audio.decode_mono(mixed)
        assert abs(audio.probe(mixed)["duration"] - 4) < 0.05
        ratio = amplitude(samples,440,1.2,1.8) / amplitude(original,440,1.2,1.8)
        assert abs(ratio - 0.5) < 0.03, ratio
        assert amplitude(samples,880,1.2,1.8) > 500
        assert amplitude(samples,880,2.3,2.8) < 30
        legacy, _ = audio.run_processor(root, source, "legacy-audio", {
            **extra, "audio_codec": "", "audio_channels": 0, "video_info_probed": True})
        legacy_ratio = amplitude(audio.decode_mono(legacy),440,1.2,1.8) / amplitude(original,440,1.2,1.8)
        assert abs(legacy_ratio - 0.5) < 0.03, legacy_ratio
        replaced, _ = audio.run_processor(root, source, "replace", {
            **extra,"external_audio":{**asset,"mode":"replace"}})
        samples = audio.decode_mono(replaced)
        assert amplitude(samples,440,1.2,1.8) < 30
        assert amplitude(samples,880,1.2,1.8) > 1500, amplitude(samples,880,1.2,1.8)
        assert amplitude(samples,880,0.2,0.8) < 30
        assert amplitude(samples,880,2.3,2.8) < 30
        assert abs(audio.probe(replaced)["duration"] - 4) < 0.05
        added, _ = audio.run_processor(root, silent, "no-original", extra)
        assert audio.probe(added)["audio_channels"] == 1
        trimmed, _ = audio.run_processor(root, source, "trim", {
            **extra,"trim_start":1,"trim_end":3,"external_audio":{**asset,"mode":"replace","offset":0.25}})
        assert abs(audio.probe(trimmed)["duration"] - 2) < 0.05
        assert amplitude(audio.decode_mono(trimmed),880,0.4,0.9) > 1500
        mp3 = str(root / "long.mp3")
        subprocess.run([audio.FFMPEG,"-v","error","-f","lavfi","-i",
                        "sine=frequency=880:sample_rate=48000:duration=6","-c:a","libmp3lame",mp3],check=True,timeout=30)
        long_output, _ = audio.run_processor(root, source, "long-mp3", {
            "external_audio":{"path":mp3,"mode":"replace"},"asset_roots":[str(root)]})
        assert abs(audio.probe(long_output)["duration"] - 4) < 0.05
        assert amplitude(audio.decode_mono(long_output),880,3.2,3.8) > 1500
        image = str(root / "overlay.png")
        subprocess.run([audio.FFMPEG,"-v","error","-f","lavfi","-i","color=c=red:s=32x32",
                        "-frames:v","1",image],check=True,timeout=30)
        with_image, _ = audio.run_processor(root, source, "overlay-music", {
            **extra,"operations":[{"mode":"image","image_path":image,"image_opacity":1,
                                    "region":{"x":24,"y":24,"w":32,"h":32}}]})
        assert amplitude(audio.decode_mono(with_image),880,1.2,1.8) > 500
        assert abs(audio.probe(with_image)["duration"] - 4) < 0.05
        print(f"external audio: mix 440Hz ratio={ratio:.4f}; replace/offset/trim/silence/no-original passed")


if __name__ == "__main__":
    run()
