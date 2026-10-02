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

describe("filmstrip extraction", () => {
  let directory;
  let input;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "beru-filmstrip-"));
    input = path.join(directory, "video.mp4");
    locations.ffmpeg = path.join(directory, "ffmpeg.exe");
    fs.writeFileSync(input, "original");
    fs.writeFileSync(locations.ffmpeg, "executable");
    vi.spyOn(os, "freemem").mockReturnValue(8 * 1024 ** 3);
    captured
      .mockReset()
      .mockImplementation(async (_command, args) =>
        jpeg(Number(args[args.indexOf("-ss") + 1]) * 10),
      );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("publishes completed samples before the entire strip, preserving time slots after failures", async () => {
    const pending = [];
    captured.mockImplementation(
      (_command, args) =>
        new Promise((resolve) => {
          pending.push({ time: Number(args[args.indexOf("-ss") + 1]), resolve });
        }),
    );
    const progress = vi.fn();
    const resultPromise = extractFilmstrip(input, { count: 4, duration: 8, onFrame: progress });
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    pending.find((p) => p.time === 7).resolve(jpeg(7));
    await vi.waitFor(() => expect(progress).toHaveBeenCalledTimes(1));
    expect(progress.mock.calls[0][0]).toMatchObject({ index: 3, count: 4, aspect: 1.5 });
    pending.find((p) => p.time === 3).resolve({ code: 1, stdout: Buffer.alloc(0) });
    pending.find((p) => p.time === 1).resolve(jpeg(1));
    pending.find((p) => p.time === 5).resolve(jpeg(5));
    const result = await resultPromise;
    expect(result.frames).toHaveLength(4);
    expect(result.frames[1]).toBeNull();
    expect(result.frames[3]).toBe(progress.mock.calls[0][0].frame);
    captured.mockResolvedValue(jpeg(9));
    await extractFilmstrip(input, { count: 4, duration: 8 });
    expect(captured).toHaveBeenCalledTimes(8);
  });

  it("reuses complete strips but invalidates changed sampling options and replaced files", async () => {
    const options = { count: 2, duration: 8 };
    const first = await extractFilmstrip(input, options);
    expect(await extractFilmstrip(input, options)).toEqual(first);
    expect(captured).toHaveBeenCalledTimes(2);
    await extractFilmstrip(input, { ...options, duration: 4 });
    await extractFilmstrip(input, { ...options, count: 3 });
    await extractFilmstrip(input, { ...options, height: 80 });
    expect(captured).toHaveBeenCalledTimes(9);
    fs.writeFileSync(input, "replacement-content");
    await extractFilmstrip(input, options);
    expect(captured).toHaveBeenCalledTimes(11);
    fs.unlinkSync(input);
    expect(await extractFilmstrip(input, options)).toBeNull();
  });

  it("stops queued extraction after abort and never caches or publishes cancelled samples", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(256 * 1024 ** 2);
    let finish;
    let signal;
    captured.mockImplementation((_command, _args, options) => {
      signal = options.spawnOptions.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const controller = new AbortController();
    const progress = vi.fn();
    const result = extractFilmstrip(input, {
      duration: 8,
      signal: controller.signal,
      onFrame: progress,
    });
    await vi.waitFor(() => expect(captured).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(signal.aborted).toBe(true);
    finish(jpeg(1));
    expect(await result).toBeNull();
    expect(captured).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
    captured.mockResolvedValue(jpeg(2));
    expect((await extractFilmstrip(input, { duration: 8 })).frames).toHaveLength(20);
    expect(captured).toHaveBeenCalledTimes(21);
  });
});
