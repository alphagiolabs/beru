"""Editor features through the same Processor CLI as Batch compositions."""
import json
import subprocess
import tempfile
from pathlib import Path

import test_audio_gain as audio
from test_composition import pixel


def run():
    with tempfile.TemporaryDirectory(prefix="beru-composition-editor-") as directory:
        source = audio.make_source(directory, "source.mp4", True)
        clip = {"input_path": source, "video_duration": 4, "trim_start": 1, "trim_end": 3,
                "playback_rate": 2, "audio_muted": True, "rotation": 90, "flip_h": True,
                "framing": {"crop": {"x": 0, "y": 0, "w": 1, "h": 1}, "fit": "cover", "zoom": 1, "offsetX": 0, "offsetY": 0}}
        title = {"id": "title", "kind": "text", "text": "Beru", "startUs": 250000, "endUs": 750000,
                 "geometry": {"x": .1, "y": .1, "w": .8, "h": .8},
                 "style": {"color": "#ffffff", "size": .1, "fontFamily": "Segoe UI", "bold": True,
                           "textShadowEnabled": True, "bgEnabled": True, "bgColor": "#ff0000", "bgOpacity": 1}}
        job = {"id": -1, "kind": "composition", "clips": [clip], "canvas": {"width": 320, "height": 180, "fit": "contain", "background": "#000000"},
               "composition_fps": 30, "overlays": [title]}
        video, log = audio.run_processor(directory, source, "editor", job)
        assert abs(audio.probe(video)["duration"] - 1) < .04
        assert audio.rms(audio.decode_mono(video)) < 1e-4
        assert pixel(video, .5, 40, 30)[0] > 180, "Title background must be composed"
        assert pixel(video, .8, 40, 30)[0] < 80, "Title end is exclusive"
        events = [json.loads(line) for line in log.splitlines() if line.startswith("{")]
        assert [e["index"] for e in events if e.get("type") == "complete"] == [-1]
        frame_path = str(Path(directory) / "exact.png")
        frame, _ = audio.run_processor(directory, source, "frame", {**job, "frame": {"atUs": 500000}, "output_path": frame_path})
        assert Path(frame).is_file()
        result = subprocess.run([audio.FFMPEG, "-v", "error", "-i", frame, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True)
        assert result.stdout[(30 * 320 + 40) * 3] > 180
        tail = {**title, "startUs": 1000000, "endUs": 2000000}
        extended, _ = audio.run_processor(directory, source, "tail", {**job, "overlays": [tail]})
        assert abs(audio.probe(extended)["duration"] - 2) < .04
        assert pixel(extended, 1.5, 40, 30)[0] > 180, "Layers extending the montage use canvas and silence"
        print("Editor composition: canonical jobs, retime/mute/transform, title interval, exact frame and canvas tail passed")


if __name__ == "__main__":
    run()
