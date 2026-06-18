import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  probeVideo: vi.fn(),
  probeVideoFast: vi.fn(),
  extractThumbnail: vi.fn(),
  renderPreviewFrame: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock("../main/utils/video-cache.js", () => ({
  probeVideo: mocks.probeVideo,
  probeVideoFast: mocks.probeVideoFast,
}));

vi.mock("../main/utils/thumbnail.js", () => ({
  extractThumbnail: mocks.extractThumbnail,
}));

vi.mock("../main/utils/preview-frame.js", () => ({
  renderPreviewFrame: mocks.renderPreviewFrame,
}));

describe("video IPC handlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.probeVideo.mockReset();
    mocks.probeVideoFast.mockReset();
    mocks.extractThumbnail.mockReset();
    mocks.renderPreviewFrame.mockReset();
  });

  it("validates every getVideoInfoBatch path before probing and preserves result order", async () => {
    const { registerVideoHandlers } = await import("../main/handlers/video.js");
    const pathSecurity = {
      validateReadableFile: vi.fn((filePath, kind) => {
        if (kind === "video" && filePath === "good.mp4") {
          return { ok: true, resolvedPath: "resolved-good.mp4" };
        }
        return { ok: false, error: "Ruta no permitida" };
      }),
    };

    mocks.probeVideoFast.mockResolvedValue({ width: 640, height: 360, duration: 1 });
    registerVideoHandlers(pathSecurity);

    const handleBatch = mocks.handlers.get("fs:getVideoInfoBatch");
    const results = await handleBatch({}, ["good.mp4", "bad.mp4"]);

    expect(pathSecurity.validateReadableFile).toHaveBeenCalledTimes(2);
    expect(mocks.probeVideoFast).toHaveBeenCalledTimes(1);
    expect(mocks.probeVideoFast).toHaveBeenCalledWith("resolved-good.mp4");
    expect(mocks.probeVideoFast).not.toHaveBeenCalledWith("bad.mp4");
    expect(results).toEqual([
      { width: 640, height: 360, duration: 1 },
      { exists: false, width: 0, height: 0, duration: 0, error: "Ruta no permitida" },
    ]);
  });

  it("preserves thumbnailBatch result order when a path is rejected", async () => {
    const { registerVideoHandlers } = await import("../main/handlers/video.js");
    const pathSecurity = {
      validateReadableFile: vi.fn((filePath, kind) => {
        if (kind === "video" && filePath === "good.mp4") {
          return { ok: true, resolvedPath: "resolved-good.mp4" };
        }
        return { ok: false, error: "Ruta no permitida" };
      }),
    };

    mocks.extractThumbnail.mockResolvedValue({ dataUrl: "data:image/jpeg;base64,ok" });
    registerVideoHandlers(pathSecurity);

    const handleBatch = mocks.handlers.get("video:thumbnailBatch");
    const results = await handleBatch({}, ["bad.mp4", "good.mp4"]);

    expect(pathSecurity.validateReadableFile).toHaveBeenCalledTimes(2);
    expect(mocks.extractThumbnail).toHaveBeenCalledTimes(1);
    expect(mocks.extractThumbnail).toHaveBeenCalledWith("resolved-good.mp4", 80);
    expect(results).toEqual([null, { dataUrl: "data:image/jpeg;base64,ok" }]);
  });
});
