import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  probeVideoFast: vi.fn(),
  extractThumbnail: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "/tmp" },
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock("os", () => ({
  default: { cpus: () => Array(8).fill({}), freemem: () => 8 * 1024 * 1024 * 1024 },
}));

vi.mock("../main/utils/paths.js", () => ({ getFfmpegPath: () => "ffmpeg" }));

vi.mock("../main/utils/video-cache.js", () => ({
  probeVideo: vi.fn(),
  probeVideoFast: mocks.probeVideoFast,
}));

vi.mock("../main/utils/thumbnail.js", () => ({ extractThumbnail: mocks.extractThumbnail }));

const spawn = vi.hoisted(() => vi.fn());
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, spawn }, spawn };
});

const probe = vi.hoisted(() => ({ text: null }));
vi.mock("../main/workerPolicy.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    pickHwEncoderFromEncodersText: (text) => {
      probe.text = text;
      return actual.pickHwEncoderFromEncodersText(text);
    },
  };
});

const { runMediaTask, setMediaProcessingActive, waitForMediaTasksToDrain } =
  await import("../main/utils/media-task-pool.js");

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn(() => true);
  return proc;
}

async function loadEncoderDetection() {
  vi.resetModules();
  probe.text = null;
  return import("../main/utils/settings.js");
}

const NVENC_LINE = "V....D h264_nvenc  NVIDIA NVENC H.264 encoder\n";

describe("media task admission during export", () => {
  it("waits for existing work to fall to the export capacity", async () => {
    const release = [];
    let active = 0;
    const tasks = Array.from({ length: 8 }, () =>
      runMediaTask(
        () =>
          new Promise((resolve) => {
            active += 1;
            release.push(() => {
              active -= 1;
              resolve();
            });
          }),
      ),
    );

    await Promise.resolve();
    expect(active).toBe(8);
    setMediaProcessingActive(true);
    let admitted = false;
    const ready = waitForMediaTasksToDrain().then(() => {
      admitted = true;
    });

    release.splice(0, 5).forEach((finish) => finish());
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(3);
    expect(admitted).toBe(false);

    release.shift()();
    await ready;
    expect(active).toBe(2);
    release.forEach((finish) => finish());
    await Promise.all(tasks);
    setMediaProcessingActive(false);
  });

  it("unblocks admission if export is cancelled before work drains", async () => {
    const release = [];
    const tasks = Array.from({ length: 8 }, () =>
      runMediaTask(() => new Promise((resolve) => release.push(resolve))),
    );
    await Promise.resolve();
    setMediaProcessingActive(true);
    let admitted = false;
    const ready = waitForMediaTasksToDrain().then(() => {
      admitted = true;
    });

    await Promise.resolve();
    expect(admitted).toBe(false);
    setMediaProcessingActive(false);
    await ready;
    expect(admitted).toBe(true);
    release.forEach((finish) => finish());
    await Promise.all(tasks);
  });
});

describe("media task queue depth", () => {
  it("rejects past the cap and accepts work again once the queue drains", async () => {
    const release = [];
    const blockers = Array.from({ length: 8 }, () =>
      runMediaTask(() => new Promise((resolve) => release.push(resolve))),
    );
    await Promise.resolve();

    const queued = Array.from({ length: 2000 }, () => runMediaTask(() => Promise.resolve("ok")));
    const started = [];
    const overflow = runMediaTask(() => {
      started.push("overflow");
      return Promise.resolve("overflow");
    });

    await expect(overflow).rejects.toThrow("Demasiadas tareas de medios en cola");

    release.forEach((finish) => finish());
    await Promise.all([...blockers, ...queued]);
    expect(started).toEqual([]);
    await expect(runMediaTask(() => Promise.resolve("after"))).resolves.toBe("after");
  });

  it("caps each queue independently and still prefers interactive work", async () => {
    const release = [];
    const blockers = Array.from({ length: 8 }, () =>
      runMediaTask(() => new Promise((resolve) => release.push(resolve))),
    );
    await Promise.resolve();

    const order = [];
    const normal = Array.from({ length: 2000 }, (_, i) =>
      runMediaTask(() => {
        order.push(`n${i}`);
      }),
    );
    const interactive = runMediaTask(
      () => {
        order.push("interactive");
      },
      { interactive: true },
    );
    await expect(runMediaTask(() => Promise.resolve("late"))).rejects.toThrow(
      "Demasiadas tareas de medios en cola",
    );

    release.forEach((finish) => finish());
    await Promise.all([...blockers, ...normal, interactive]);
    expect(order).toHaveLength(2001);
    expect(order[0]).toBe("interactive");
    expect(order[1]).toBe("n0");
    expect(order[2]).toBe("n1");
  });
});

describe("ffmpeg encoder probe output limit", () => {
  it("truncates an oversized encoder list and still resolves the encoder", async () => {
    const { detectHwEncoderCached } = await loadEncoderDetection();
    const proc = fakeProcess();
    spawn.mockReturnValueOnce(proc);
    const detected = detectHwEncoderCached();
    proc.stdout.write(Buffer.from(NVENC_LINE));
    proc.stdout.write(Buffer.alloc(4 * 1024 * 1024, 0x7a));
    proc.emit("close", 0);

    await expect(detected).resolves.toBe("h264_nvenc");
    expect(probe.text).toHaveLength(1024 * 1024);
    expect(probe.text.startsWith(NVENC_LINE)).toBe(true);
    expect(probe.text.endsWith("z".repeat(1000))).toBe(true);
  });

  it("keeps draining the pipes past the cap so the child can still close", async () => {
    const { detectHwEncoderCached } = await loadEncoderDetection();
    const proc = fakeProcess();
    spawn.mockReturnValueOnce(proc);
    const detected = detectHwEncoderCached();
    proc.stdout.write(Buffer.alloc(2 * 1024 * 1024, 0x61));

    expect(proc.stdout.listenerCount("data")).toBe(1);
    expect(proc.stderr.listenerCount("data")).toBe(1);
    expect(proc.kill).not.toHaveBeenCalled();

    proc.emit("close", 0);
    await expect(detected).resolves.toBeNull();
    expect(probe.text).toHaveLength(1024 * 1024);
  });

  it("leaves an in-budget encoder list untouched", async () => {
    const { detectHwEncoderCached } = await loadEncoderDetection();
    const proc = fakeProcess();
    spawn.mockReturnValueOnce(proc);
    const detected = detectHwEncoderCached();
    const text = `Encoders:\n V..... = Video\n${NVENC_LINE} A..... = Audio\n`;
    proc.stdout.write(Buffer.from(text));
    proc.emit("close", 0);

    await expect(detected).resolves.toBe("h264_nvenc");
    expect(probe.text).toBe(text);
  });
});

describe("hw encoder probe caching", () => {
  it("does not cache a failed probe and retries detection", async () => {
    const { detectHwEncoderCached } = await loadEncoderDetection();
    const bad = fakeProcess();
    spawn.mockReturnValueOnce(bad);
    const first = detectHwEncoderCached();
    bad.emit("error", new Error("spawn ffmpeg failed"));
    await expect(first).resolves.toBeNull();

    const good = fakeProcess();
    spawn.mockReturnValueOnce(good);
    const second = detectHwEncoderCached();
    good.stdout.write(Buffer.from(NVENC_LINE));
    good.emit("close", 0);
    await expect(second).resolves.toBe("h264_nvenc");
  });

  it("caches a completed probe even when no hardware encoder is found", async () => {
    const { detectHwEncoderCached } = await loadEncoderDetection();
    const proc = fakeProcess();
    spawn.mockReturnValueOnce(proc);
    const first = detectHwEncoderCached();
    proc.stdout.write(Buffer.from("Encoders:\n V....D libx264  libx264 H.264\n"));
    proc.emit("close", 0);
    await expect(first).resolves.toBeNull();

    const callsAfterFirst = spawn.mock.calls.length;
    await expect(detectHwEncoderCached()).resolves.toBeNull();
    expect(spawn.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("video batch handler size guard", () => {
  const allowAll = {
    validateReadableFile: vi.fn((filePath) => ({ ok: true, resolvedPath: filePath })),
  };

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.probeVideoFast.mockReset();
    mocks.extractThumbnail.mockReset();
  });

  it("rejects an oversized getVideoInfoBatch before validating any path", async () => {
    const { registerVideoHandlers } = await import("../main/handlers/video.js");
    mocks.probeVideoFast.mockResolvedValue({ width: 640, height: 360, duration: 1 });
    registerVideoHandlers(allowAll);

    const handle = mocks.handlers.get("fs:getVideoInfoBatch");
    await expect(
      handle(
        {},
        Array.from({ length: 501 }, (_, i) => `v${i}.mp4`),
      ),
    ).rejects.toThrow("Demasiados videos en una sola solicitud");
    expect(allowAll.validateReadableFile).not.toHaveBeenCalled();
    expect(mocks.probeVideoFast).not.toHaveBeenCalled();
  });

  it("rejects an oversized thumbnailBatch before extracting anything", async () => {
    const { registerVideoHandlers } = await import("../main/handlers/video.js");
    mocks.extractThumbnail.mockResolvedValue({ dataUrl: "data:image/jpeg;base64,ok" });
    registerVideoHandlers(allowAll);

    const handle = mocks.handlers.get("video:thumbnailBatch");
    await expect(
      handle(
        {},
        Array.from({ length: 501 }, (_, i) => `v${i}.mp4`),
      ),
    ).rejects.toThrow("Demasiados videos en una sola solicitud");
    expect(mocks.extractThumbnail).not.toHaveBeenCalled();
  });

  it("still serves a batch at the cap", async () => {
    const { registerVideoHandlers } = await import("../main/handlers/video.js");
    mocks.probeVideoFast.mockResolvedValue({ width: 640, height: 360, duration: 1 });
    registerVideoHandlers(allowAll);

    const paths = Array.from({ length: 500 }, (_, i) => `v${i}.mp4`);
    const results = await mocks.handlers.get("fs:getVideoInfoBatch")({}, paths);
    expect(results).toHaveLength(500);
    expect(mocks.probeVideoFast).toHaveBeenCalledTimes(500);
  });
});
