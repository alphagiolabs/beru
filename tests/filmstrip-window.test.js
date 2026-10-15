import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => vi.fn());
const locations = vi.hoisted(() => ({ ffmpeg: "" }));
vi.mock("../main/utils/paths.js", () => ({ getFfmpegPath: () => locations.ffmpeg }));
vi.mock("../main/utils/run-captured.js", () => ({ runCapturedProcess: captured }));
import { extractFilmstrip } from "../main/utils/thumbnail.js";

function jpeg(tag) {
  const buffer = Buffer.alloc(64, tag);
  buffer.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 64, 0, 96]);
  return { code: 0, stdout: buffer };
}

const seekTimes = () =>
  captured.mock.calls.map(([, args]) => Number(args[args.indexOf("-ss") + 1]));

describe("filmstrip window", () => {
  let directory;
  let input;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "beru-filmstrip-window-"));
    input = path.join(directory, "clip.mp4");
    locations.ffmpeg = path.join(directory, "ffmpeg.exe");
    fs.writeFileSync(input, "original");
    fs.writeFileSync(locations.ffmpeg, "executable");
    vi.spyOn(os, "freemem").mockReturnValue(8 * 1024 ** 3);
    captured.mockReset().mockImplementation(async () => jpeg(1));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("samples only inside the requested source window, so a clip shows its own frames", async () => {
    const result = await extractFilmstrip(input, { count: 4, duration: 2, start: 10 });
    expect(result.frames).toHaveLength(4);
    const times = seekTimes();
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) {
      expect(time).toBeGreaterThanOrEqual(10);
      expect(time).toBeLessThan(12);
    }
  });

  it("keeps windows of the same file apart in the cache", async () => {
    await extractFilmstrip(input, { count: 2, duration: 2, start: 0 });
    const firstCount = captured.mock.calls.length;
    await extractFilmstrip(input, { count: 2, duration: 2, start: 10 });
    expect(captured.mock.calls.length).toBeGreaterThan(firstCount);
    expect(
      seekTimes()
        .slice(firstCount)
        .every((time) => time >= 10),
    ).toBe(true);
  });
});
