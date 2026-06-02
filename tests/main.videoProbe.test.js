import { describe, it, expect } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import os from "os";
import { parseFfmpegOutput, parseFfprobeJson, probeVideoFile } from "../main/videoProbe.js";

describe("main/videoProbe metadata parsing", () => {
  it("parses ffprobe JSON metadata", () => {
    const info = parseFfprobeJson(JSON.stringify({
      format: { duration: "12.5" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          pix_fmt: "yuv420p",
          r_frame_rate: "30000/1001",
        },
        { codec_type: "audio", codec_name: "aac" },
      ],
    }));

    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.duration).toBe(12.5);
    expect(info.videoCodec).toBe("h264");
    expect(info.pixFmt).toBe("yuv420p");
    expect(info.frameRate).toBeCloseTo(29.97, 2);
    expect(info.audioCodec).toBe("aac");
  });

  it("parses ffmpeg input-probe output", () => {
    const info = parseFfmpegOutput(`
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'sample.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 37 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p(progressive), 320x180 [SAR 1:1 DAR 16:9], 29.97 fps, 29.97 tbr, 16384 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC), 44100 Hz, stereo, fltp
At least one output file must be specified
`);

    expect(info.width).toBe(320);
    expect(info.height).toBe(180);
    expect(info.duration).toBe(62.5);
    expect(info.videoCodec).toBe("h264");
    expect(info.pixFmt).toBe("yuv420p");
    expect(info.frameRate).toBeCloseTo(29.97, 2);
    expect(info.audioCodec).toBe("aac");
  });
});

const bundledFfmpeg = path.resolve("src-tauri", "bin", "ffmpeg.exe");
const describeIfBundledFfmpeg = existsSync(bundledFfmpeg) ? describe : describe.skip;

describeIfBundledFfmpeg("main/videoProbe fallback", () => {
  it("falls back to ffmpeg when ffprobe produces no JSON", async () => {
    const tmp = path.join(os.tmpdir(), `beru-video-probe-${Date.now()}.mp4`);
    try {
      const makeVideo = spawnSync(bundledFfmpeg, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=320x180:rate=1",
        "-t", "1",
        "-pix_fmt", "yuv420p",
        tmp,
      ], { encoding: "utf8" });

      expect(makeVideo.status).toBe(0);

      const info = await probeVideoFile(tmp, {
        ffprobePath: bundledFfmpeg,
        ffmpegPath: bundledFfmpeg,
        timeoutMs: 10000,
      });

      expect(info.width).toBe(320);
      expect(info.height).toBe(180);
      expect(info.videoCodec).toBe("h264");
      expect(info.pixFmt).toBe("yuv420p");
    } finally {
      try { unlinkSync(tmp); } catch {}
    }
  });
});
