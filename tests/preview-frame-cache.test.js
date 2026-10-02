import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  run: vi.fn(),
  handlers: new Map(),
}));
vi.mock("../main/utils/preview-frame.js", () => ({
  renderPreviewFrame: mocks.render,
  renderSourceFrame: (payload) => mocks.render({ ...payload, source_only: true }),
  disposePreviewFrameWorker: mocks.dispose,
}));
vi.mock("../main/utils/media-task-pool.js", async (importOriginal) => ({
  ...(await importOriginal()),
  runMediaTask: mocks.run,
}));
vi.mock("electron", () => ({
  app: { isPackaged: false },
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
}));

import {
  renderPreviewFrame,
  renderSourceFrame,
  disposePreviewFrameWorker,
} from "../main/utils/preview-frame-cache.js";
import { registerVideoHandlers } from "../main/handlers/video.js";

const FRAME = { ok: true, data_url: "data:image/jpeg;base64,/9j/2Q==", width: 16, height: 16 };
const NEW_FRAME = { ...FRAME, data_url: "data:image/jpeg;base64,/9j/AA==" };
let directory;
let input;
let image;
let job;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.run.mockImplementation((task) => Promise.resolve().then(task));
  mocks.render.mockReset().mockResolvedValue({ ...FRAME });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "beru-preview-cache-"));
  input = path.join(directory, "source.mp4");
  image = path.join(directory, "logo.png");
  fs.writeFileSync(input, "source");
  fs.writeFileSync(image, "image");
  job = { input_path: input, timestamp: 1.5, operations: [] };
});

afterEach(() => {
  disposePreviewFrameWorker();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("exact preview frame cache", () => {
  it("reuses a completed frame without admitting another media task", async () => {
    expect(await renderPreviewFrame(job)).toEqual(FRAME);
    expect(await renderPreviewFrame(JSON.parse(JSON.stringify(job)))).toEqual(FRAME);
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("shares concurrent identical renders instead of replacing one of them", async () => {
    const results = await Promise.all([renderPreviewFrame(job), renderPreviewFrame({ ...job })]);
    expect(results).toEqual([FRAME, FRAME]);
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["timestamp", { timestamp: 1.500001 }],
    ["operations", { operations: [{ mode: "text", text: "Changed" }] }],
    ["dimensions", { source_width: 3840, source_height: 2160 }],
    ["watermark", { watermark: { enabled: true, type: "text", text: "Changed" } }],
  ])("renders a new frame when %s changes", async (_name, change) => {
    await renderPreviewFrame(job);
    mocks.render.mockResolvedValueOnce(NEW_FRAME);
    expect(await renderPreviewFrame({ ...job, ...change })).toEqual(NEW_FRAME);
    expect(await renderPreviewFrame(job)).toEqual(FRAME);
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it.each(["source", "overlay", "delogo image", "watermark image"])(
    "invalidates the frame when the %s file changes",
    async (kind) => {
      const payload = {
        ...job,
        operations: [{ mode: "image", image_path: image, delogo_image_path: image }],
        watermark: { enabled: true, type: "image", imagePath: image },
      };
      if (kind !== "overlay") delete payload.operations[0].image_path;
      if (kind !== "delogo image") delete payload.operations[0].delogo_image_path;
      if (kind !== "watermark image") delete payload.watermark;
      await renderPreviewFrame(payload);
      const changed = kind === "source" ? input : image;
      const info = fs.statSync(changed);
      fs.utimesSync(changed, info.atime, new Date(info.mtimeMs + 5000));
      mocks.render.mockResolvedValueOnce(NEW_FRAME);
      expect(await renderPreviewFrame(payload)).toEqual(NEW_FRAME);
      expect(mocks.render).toHaveBeenCalledTimes(2);
    },
  );

  it("does not return a cached frame after its source is deleted", async () => {
    await renderPreviewFrame(job);
    fs.unlinkSync(input);
    mocks.render.mockResolvedValueOnce({ ok: false, error: "Input not found" });
    expect(await renderPreviewFrame(job)).toEqual({ ok: false, error: "Input not found" });
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it("keeps source-only frames separate from filtered previews", async () => {
    await renderPreviewFrame(job);
    mocks.render.mockResolvedValueOnce(NEW_FRAME);
    expect(await renderSourceFrame(job)).toEqual(NEW_FRAME);
    expect(await renderPreviewFrame(job)).toEqual(FRAME);
    expect(await renderSourceFrame(job)).toEqual(NEW_FRAME);
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it.each([{ ok: false, error: "FFmpeg failed" }, { ok: false, cancelled: true }, { ok: true }])(
    "retries instead of caching an unsuccessful response: %j",
    async (failed) => {
      mocks.render.mockResolvedValueOnce(failed);
      expect(await renderPreviewFrame(job)).toEqual(failed);
      expect(await renderPreviewFrame(job)).toEqual(FRAME);
      expect(mocks.render).toHaveBeenCalledTimes(2);
    },
  );

  it("evicts the least recently used frame after reaching the entry limit", async () => {
    for (let timestamp = 0; timestamp < 32; timestamp++) {
      await renderPreviewFrame({ ...job, timestamp });
    }
    await renderPreviewFrame({ ...job, timestamp: 0 });
    await renderPreviewFrame({ ...job, timestamp: 32 });
    await renderPreviewFrame({ ...job, timestamp: 0 });
    expect(mocks.render).toHaveBeenCalledTimes(33);
    await renderPreviewFrame({ ...job, timestamp: 1 });
    expect(mocks.render).toHaveBeenCalledTimes(34);
  });

  it("evicts large responses before reaching the entry limit", async () => {
    mocks.render.mockResolvedValue({
      ...FRAME,
      data_url: `data:image/jpeg;base64,${"A".repeat(3 * 1024 * 1024)}`,
    });
    for (let timestamp = 0; timestamp < 6; timestamp++) {
      await renderPreviewFrame({ ...job, timestamp });
    }
    await renderPreviewFrame({ ...job, timestamp: 5 });
    expect(mocks.render).toHaveBeenCalledTimes(6);
    await renderPreviewFrame({ ...job, timestamp: 0 });
    expect(mocks.render).toHaveBeenCalledTimes(7);
  });

  it("clears cached frames and does not retain a render completed after disposal", async () => {
    await renderPreviewFrame(job);
    let complete;
    mocks.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = renderPreviewFrame({ ...job, timestamp: 2 });
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    disposePreviewFrameWorker();
    complete(FRAME);
    await pending;
    await renderPreviewFrame(job);
    await renderPreviewFrame({ ...job, timestamp: 2 });
    expect(mocks.render).toHaveBeenCalledTimes(4);
  });

  it("validates IPC access even when the requested frame is cached", async () => {
    let allowed = true;
    registerVideoHandlers({
      validateReadableFile: () =>
        allowed ? { ok: true, resolvedPath: input } : { ok: false, error: "Access revoked" },
    });
    const handle = mocks.handlers.get("video:renderPreviewFrame");
    expect(await handle({}, job)).toEqual(FRAME);
    expect(await handle({}, job)).toEqual(FRAME);
    expect(mocks.render).toHaveBeenCalledTimes(1);
    allowed = false;
    expect(await handle({}, job)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Access revoked"),
    });
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it("does not start a worker for a request still waiting for admission when disposed", async () => {
    let admit;
    mocks.run.mockImplementationOnce(
      (task) =>
        new Promise((resolve) => {
          admit = () => resolve(task());
        }),
    );
    const request = renderPreviewFrame(job);
    await vi.waitFor(() => expect(admit).toBeTypeOf("function"));
    disposePreviewFrameWorker();
    admit();
    expect(await request).toMatchObject({ ok: false, cancelled: true });
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
