import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => vi.fn());
const locations = vi.hoisted(() => ({ ffmpeg: "", directory: "" }));
vi.mock("../main/utils/paths.js", () => ({
  getFfmpegPath: () => locations.ffmpeg,
  getThumbnailCacheDirectory: () => locations.directory,
}));
vi.mock("../main/utils/run-captured.js", () => ({ runCapturedProcess: captured }));

function jpeg() {
  const buffer = Buffer.alloc(64);
  buffer.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 46, 0, 80]);
  return { code: 0, stdout: buffer };
}

async function freshExtractor() {
  vi.resetModules();
  return (await import("../main/utils/thumbnail.js")).extractThumbnail;
}

describe("thumbnail persistence pipeline", () => {
  let directory;
  let input;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "beru-thumb-pipeline-"));
    locations.directory = path.join(directory, "cache");
    locations.ffmpeg = path.join(directory, "ffmpeg.exe");
    input = path.join(directory, "video.mp4");
    fs.writeFileSync(input, "original");
    fs.writeFileSync(locations.ffmpeg, "executable");
    captured.mockReset().mockResolvedValue(jpeg());
    vi.spyOn(os, "freemem").mockReturnValue(8 * 1024 ** 3);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("restores the same image in a fresh pipeline without FFmpeg and rejects a deleted source", async () => {
    const first = await (await freshExtractor())(input);
    locations.ffmpeg = null;
    const restarted = await freshExtractor();
    expect(await restarted(input)).toEqual(first);
    expect(captured).toHaveBeenCalledTimes(1);
    fs.unlinkSync(input);
    expect(await restarted(input)).toBeNull();
  });

  it("invalidates disk and memory entries on width or file changes even with restored mtime", async () => {
    const extract = await freshExtractor();
    await extract(input);
    await extract(input, 160);
    expect(captured).toHaveBeenCalledTimes(2);
    const originalMtime = fs.statSync(input).mtime;
    fs.writeFileSync(input, "replacement-with-new-size");
    fs.utimesSync(input, originalMtime, originalMtime);
    await extract(input);
    expect(captured).toHaveBeenCalledTimes(3);
    expect(await (await freshExtractor())(input)).toBeTruthy();
    expect(captured).toHaveBeenCalledTimes(3);
  });

  it("continues generating thumbnails when the cache directory cannot be created", async () => {
    fs.writeFileSync(locations.directory, "blocked");
    const first = await (await freshExtractor())(input);
    expect(first?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(await (await freshExtractor())(input)).toEqual(first);
    expect(captured).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(locations.directory, "utf8")).toBe("blocked");
  });

  it("does not persist a thumbnail when the source changes during extraction", async () => {
    let finish;
    captured.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const extract = await freshExtractor();
    const pending = extract(input);
    await vi.waitFor(() => expect(captured).toHaveBeenCalledTimes(1));
    fs.writeFileSync(input, "changed-during-render");
    finish(jpeg());
    await pending;
    expect(fs.readdirSync(locations.directory)).toEqual([]);
    captured.mockResolvedValue(jpeg());
    await extract(input);
    expect(captured).toHaveBeenCalledTimes(2);
  });
});
