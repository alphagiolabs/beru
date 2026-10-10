import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const probeVideoFile = vi.hoisted(() => vi.fn());

vi.mock("../main/videoProbe.js", () => ({ probeVideoFile }));
vi.mock("../main/utils/paths.js", () => ({
  getFfprobePath: () => "ffprobe",
  getFfmpegPath: () => "ffmpeg",
}));

const { probeVideo } = await import("../main/utils/video-cache.js");

describe("probeVideo cache", () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-video-cache-"));
    file = path.join(dir, "clip.mp4");
    fs.writeFileSync(file, "a");
    probeVideoFile.mockReset();
    probeVideoFile.mockResolvedValue({ width: 1920, height: 1080, duration: 3 });
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("shares concurrent probes and reuses the result while the file is unchanged", async () => {
    const [a, b] = await Promise.all([probeVideo(file), probeVideo(file)]);
    expect(a).toBe(b);
    await probeVideo(file);
    expect(probeVideoFile).toHaveBeenCalledTimes(1);
  });

  it("probes again after the file changes", async () => {
    await probeVideo(file);
    fs.writeFileSync(file, "changed");
    await probeVideo(file);
    expect(probeVideoFile).toHaveBeenCalledTimes(2);
  });
});
