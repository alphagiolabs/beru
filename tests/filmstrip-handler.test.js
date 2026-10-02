import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_INVOKE, IPC_EVENTS } from "../shared/ipc-channels.js";

const mocks = vi.hoisted(() => ({ handlers: new Map(), extractFilmstrip: vi.fn() }));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
}));
vi.mock("../main/utils/thumbnail.js", () => ({
  extractFilmstrip: mocks.extractFilmstrip,
  extractThumbnail: vi.fn(),
}));
vi.mock("../main/utils/video-cache.js", () => ({ probeVideo: vi.fn(), probeVideoFast: vi.fn() }));
vi.mock("../main/utils/preview-frame-cache.js", () => ({
  renderPreviewFrame: vi.fn(),
  renderSourceFrame: vi.fn(),
}));
import { registerVideoHandlers } from "../main/handlers/video.js";

function sender(id) {
  const contents = new EventEmitter();
  Object.assign(contents, { id, isDestroyed: () => false, send: vi.fn() });
  return contents;
}

describe("filmstrip request ownership", () => {
  let pending;
  beforeEach(() => {
    pending = [];
    mocks.extractFilmstrip.mockReset().mockImplementation(
      (_path, options) =>
        new Promise((resolve) => {
          pending.push({ ...options, resolve });
        }),
    );
    registerVideoHandlers({
      validateReadableFile: () => ({ ok: true, resolvedPath: "video.mp4" }),
    });
  });
  const get = (contents, requestId) =>
    mocks.handlers.get(IPC_INVOKE.getFilmstrip)(
      { sender: contents },
      { path: "video.mp4", duration: 12, requestId },
    );
  const cancel = (contents, requestId) =>
    mocks.handlers.get(IPC_INVOKE.cancelFilmstrip)({ sender: contents }, requestId);

  it("replaces only the same window's request and prevents stale progress or cleanup from cancelling its replacement", async () => {
    const firstWindow = sender(1);
    const secondWindow = sender(2);
    const old = get(firstWindow, "old");
    const independent = get(secondWindow, "independent");
    const current = get(firstWindow, "current");
    expect(pending.map((p) => p.signal.aborted)).toEqual([true, false, false]);
    expect(cancel(secondWindow, "current")).toBe(false);
    expect(cancel(firstWindow, "old")).toBe(false);
    pending[0].onFrame({ index: 0, frame: "old" });
    pending[2].onFrame({ index: 0, frame: "current" });
    expect(firstWindow.send.mock.calls).toEqual([
      [IPC_EVENTS.onFilmstripProgress, { index: 0, frame: "current", requestId: "current" }],
    ]);
    expect(secondWindow.send).not.toHaveBeenCalled();
    pending[0].resolve(null);
    await old;
    expect(cancel(firstWindow, "current")).toBe(true);
    pending[1].resolve(null);
    pending[2].resolve(null);
    await Promise.all([independent, current]);
    expect(firstWindow.listenerCount("destroyed")).toBe(0);
    expect(cancel(firstWindow, "current")).toBe(false);
  });

  it.each(["destroyed", "render-process-gone", "did-start-navigation"])(
    "cancels work when its owner emits %s",
    async (event) => {
      const contents = sender(1);
      const request = get(contents, "owner");
      contents.emit(event, {}, "file:///reload", false, true);
      expect(pending[0].signal.aborted).toBe(true);
      pending[0].onFrame({ index: 0, frame: "late" });
      expect(contents.send).not.toHaveBeenCalled();
      pending[0].resolve(null);
      await request;
      expect(contents.eventNames()).toEqual([]);
    },
  );
});
