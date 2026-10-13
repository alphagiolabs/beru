"""Stabilization as derived media: measured residual motion, borders, audio and original intact."""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import test_audio_gain as audio
from test_external_audio import amplitude

WIDTH, HEIGHT = 64, 36


def gray_frames(path, seconds=None):
    command = [audio.FFMPEG, '-v', 'error', '-i', path, '-an', '-vf', f'scale={WIDTH}:{HEIGHT},format=gray']
    if seconds:
        command += ['-t', str(seconds)]
    data = subprocess.run(command + ['-f', 'rawvideo', '-'], capture_output=True, check=True, timeout=60).stdout
    size = WIDTH * HEIGHT
    return [data[i:i + size] for i in range(0, len(data) - size + 1, size)]


def residual_motion(path):
    frames = gray_frames(path)
    total = sum(sum(abs(a - b) for a, b in zip(first, second)) for first, second in zip(frames, frames[1:]))
    return total / (len(frames) - 1) / (WIDTH * HEIGHT)


def corners_dark(path):
    """Fraction of sampled frames whose corner blocks contain black border fill."""
    dark = 0
    frames = gray_frames(path)
    for frame in frames[2:-2]:
        blocks = [(0, 0), (WIDTH - 3, 0), (0, HEIGHT - 3), (WIDTH - 3, HEIGHT - 3)]
        if any(sum(frame[(y + j) * WIDTH + x + i] for i in range(3) for j in range(3)) / 9 < 8 for x, y in blocks):
            dark += 1
    return dark / max(1, len(frames) - 4)


def make_shaky(root):
    still = str(root / 'still.png')
    subprocess.run([audio.FFMPEG, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=960x540:r=1:d=1', '-frames:v', '1',
                    '-vf', 'scale=960:540', still], check=True, timeout=30)
    shaky = str(root / 'shaky.mp4')
    shake = "crop=640:360:x='160+50*sin(2*PI*t*1.3)':y='90+25*sin(2*PI*t*1.9+1)'"
    subprocess.run([audio.FFMPEG, '-v', 'error', '-loop', '1', '-framerate', '30', '-t', '6', '-i', still,
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
                    '-vf', shake, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', shaky],
                   check=True, timeout=90)
    return shaky


def stabilize(root, source, name, settings, **extra):
    return audio.run_processor(root, source, name, {'id': -2, 'kind': 'stabilization', 'stabilization': settings, **extra})


def run():
    with tempfile.TemporaryDirectory(prefix='beru-stab-') as directory:
        root = Path(directory)
        source = make_shaky(root)
        original_hash = hashlib.sha256(Path(source).read_bytes()).hexdigest()
        shaky_motion = residual_motion(source)
        assert shaky_motion > 2, shaky_motion
        source_audio = audio.decode_mono(source)
        results = {}
        for edges in ('zoom', 'keep'):
            output, log = stabilize(root, source, f'stab-{edges}', {'intensity': 'high', 'edges': edges})
            info = audio.probe(output)
            assert (info['width'], info['height']) == (640, 360), info
            assert abs(info['duration'] - 6) < .1, info
            residual = residual_motion(output)
            assert residual < shaky_motion * .5, (edges, residual, shaky_motion)
            samples = audio.decode_mono(output)
            assert abs(audio.rms(samples) - audio.rms(source_audio)) < .01 and amplitude(samples, 440, 1, 5) > 1500
            events = [json.loads(line) for line in log.splitlines() if line.startswith('{')]
            assert [event['index'] for event in events if event.get('type') == 'complete'] == [-2], events
            progress = [event['percent'] for event in events if event.get('type') == 'job_progress']
            assert progress == sorted(progress) and progress[-1] == 100, progress
            results[edges] = output
        assert corners_dark(results['zoom']) < .1, 'Optimal zoom must remove border fill'
        assert corners_dark(results['keep']) > .3, 'Keep mode must declare its black borders'
        assert hashlib.sha256(Path(source).read_bytes()).hexdigest() == original_hash, 'Original must be untouched'
        sample, _ = stabilize(root, source, 'stab-sample', {'intensity': 'medium', 'edges': 'zoom'}, sample_seconds=2)
        assert abs(audio.probe(sample)['duration'] - 2) < .1, audio.probe(sample)
        silent = str(root / 'silent.mp4')
        subprocess.run([audio.FFMPEG, '-v', 'error', '-i', source, '-an', '-c:v', 'copy', silent], check=True, timeout=30)
        output, _ = stabilize(root, silent, 'stab-silent', {'intensity': 'low', 'edges': 'zoom'})
        assert not audio.probe(output)['audio_codec'], 'A source without audio must stay without audio'
        anamorphic = str(root / 'anamorphic.mp4')
        subprocess.run([audio.FFMPEG, '-v', 'error', '-i', source, '-vf', 'setsar=4/3', '-an', '-c:v', 'libx264', anamorphic], check=True, timeout=30)
        output, _ = stabilize(root, anamorphic, 'stab-anamorphic', {'intensity': 'medium', 'edges': 'zoom'}, sample_seconds=2)
        stream = json.loads(subprocess.run([audio.FFPROBE, '-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', output], capture_output=True, text=True, check=True).stdout)['streams'][0]
        assert stream['sample_aspect_ratio'] == '4:3' and stream['display_aspect_ratio'] == '64:27', 'Stabilization must retain anamorphic presentation'
        invalid = root / 'invalid.json'
        invalid.write_text(json.dumps({'type': 'beru-job-manifest', 'version': 1, 'jobs': [
            {'id': -2, 'kind': 'stabilization', 'input_path': source, 'output_path': str(root / 'bad.mp4'),
             'stabilization': {'intensity': 'extreme', 'edges': 'zoom'}}]}))
        rejected = subprocess.run([sys.executable, str(audio.PROCESSOR), str(invalid)], capture_output=True, text=True, timeout=30)
        assert rejected.returncode != 0 and not (root / 'bad.mp4').exists()
        assert not list(root.glob('beru-stabilization-*'))
        awkward = root / "O'Brien, [1]; 100% año"
        awkward.mkdir()
        shaky = str(awkward / 'shaky.mp4')
        Path(shaky).write_bytes(Path(source).read_bytes())
        output, _ = stabilize(awkward, shaky, 'out', {'intensity': 'low', 'edges': 'zoom'}, sample_seconds=2)
        assert abs(audio.probe(output)['duration'] - 2) < .1, 'Scratch paths with filtergraph characters must work'
        print(f'Stabilization: residual motion {shaky_motion:.2f} -> zoom {residual_motion(results["zoom"]):.2f} / '
              f'keep {residual_motion(results["keep"]):.2f}; audio, borders, sample and original passed')


if __name__ == '__main__':
    run()
