import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";

const PY = "python";
const hasPython = (() => {
  try {
    const r = spawnSync(PY, ["--version"], { encoding: "utf8" });
    return r.status === 0;
  } catch {
    return false;
  }
})();
const describeIfPython = hasPython ? describe : describe.skip;

describeIfPython("python/processor.py ffprobe N/A handling", () => {
  const PY_CODE_PREFIX =
    "import sys; sys.stdout.reconfigure(encoding='utf-8'); sys.path.insert(0, 'python'); ";

  it("returns valid dimensions when ffprobe reports bit_rate/duration as 'N/A'", () => {
    const code = `
import json, logging
import processor

logging.disable(logging.CRITICAL)

fake_json = json.dumps({
    "format": {"duration": "N/A", "bit_rate": "N/A"},
    "streams": [
        {"codec_type": "video", "width": 1920, "height": 1080,
         "codec_name": "h264", "pix_fmt": "yuv420p", "r_frame_rate": "30/1"},
        {"codec_type": "audio", "codec_name": "aac", "channels": 2},
    ],
})

class FakeResult:
    stdout = fake_json
    stderr = ""
    returncode = 0

def fake_run(cmd, **kw):
    if "-show_streams" in cmd or "-show_format" in cmd:
        return FakeResult()
    # Any other subprocess.run call (e.g. ffmpeg fallback probe) fails.
    class Fallback:
        stdout = ""
        stderr = ""
        returncode = 1
    return Fallback()

processor.subprocess.run = fake_run
processor.FFPROBE = "ffprobe"
processor.os.path.isfile = lambda p: True
processor.os.path.exists = lambda p: True

result = processor.ffprobe("whatever.mp4")
print(json.dumps(result))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);

    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.width).toBe(1920);
    expect(parsed.height).toBe(1080);
    expect(parsed.video_codec).toBe("h264");
    expect(parsed.frame_rate).toBe(30);
    expect(parsed.audio_codec).toBe("aac");
    expect(parsed.audio_channels).toBe(2);
    expect(parsed.bit_rate).toBe(0);
    expect(parsed.duration).toBe(0);
  });
});
