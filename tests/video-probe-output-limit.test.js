import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, spawn }, spawn };
});

import { probeVideoFile } from "../main/videoProbe.js";

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn(() => true);
  return proc;
}

describe("video probe process output limits", () => {
  it("rejects oversized ffprobe JSON rather than parsing its valid prefix", async () => {
    const proc = fakeProcess();
    spawn.mockReturnValueOnce(proc);
    const result = probeVideoFile(process.execPath, {
      ffprobePath: process.execPath,
      allowFfmpegFallback: false,
    });
    proc.stdout.write(
      JSON.stringify({ streams: [{ codec_type: "video", width: 640, height: 480 }] }),
    );
    proc.stdout.write(" ".repeat(2 * 1024 * 1024));
    proc.emit("close", 0);
    expect((await result).width).toBe(0);
    expect(proc.kill).toHaveBeenCalled();
    expect(proc.stdout.listenerCount("data")).toBe(0);
    expect(proc.stderr.listenerCount("data")).toBe(0);
  });

  it("bounds ffmpeg stderr and does not accept a truncated successful probe", async () => {
    const proc = fakeProcess();
    spawn.mockReturnValueOnce(proc);
    const result = probeVideoFile(process.execPath, { ffmpegPath: process.execPath });
    proc.stderr.write("Video: h264, yuv420p, 320x180, 25 fps\n");
    proc.stderr.write("X".repeat(512 * 1024));
    proc.emit("close", 0);
    expect((await result).width).toBe(0);
    expect(proc.kill).toHaveBeenCalled();
  });

  it("keeps the media slot until the timed-out child closes, then cleans listeners", async () => {
    vi.useFakeTimers();
    try {
      const proc = fakeProcess();
      spawn.mockReturnValueOnce(proc);
      const result = probeVideoFile(process.execPath, {
        ffprobePath: process.execPath,
        timeoutMs: 10,
        allowFfmpegFallback: false,
      });
      await vi.advanceTimersByTimeAsync(11);
      let settled = false;
      result.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      proc.emit("close", 1);
      expect((await result).width).toBe(0);
      expect(proc.kill).toHaveBeenCalled();
      expect(proc.stdout.listenerCount("data")).toBe(0);
      expect(proc.stderr.listenerCount("data")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
