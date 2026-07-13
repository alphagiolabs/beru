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

  it("renderPreviewFrame rejects unauthorized overlay images before calling the worker", async () => {
    const { registerVideoHandlers } = await import("../main/handlers/video.js");
    const pathSecurity = {
      validateReadableFile: vi.fn((filePath, kind) => {
        if (kind === "video" && filePath === "good.mp4") {
          return { ok: true, resolvedPath: "C:\\videos\\good.mp4" };
        }
        if (kind === "image") {
          return { ok: false, error: "Ruta no permitida" };
        }
        return { ok: false, error: "Ruta no permitida" };
      }),
    };

    registerVideoHandlers(pathSecurity);
    const handle = mocks.handlers.get("video:renderPreviewFrame");
    const result = await handle(
      {},
      {
        input_path: "good.mp4",
        operations: [{ mode: "image", image_path: "C:\\evil\\logo.png" }],
      },
    );

    expect(result).toEqual({ ok: false, error: "Imagen no permitida: Ruta no permitida" });
    expect(mocks.renderPreviewFrame).not.toHaveBeenCalled();
  });

  it("renderPreviewFrame passes sanitized asset_roots for registered overlay images", async () => {
    const { registerVideoHandlers } = await import("../main/handlers/video.js");
    const pathSecurity = {
      validateReadableFile: vi.fn((filePath, kind) => {
        if (kind === "video" && filePath === "good.mp4") {
          return { ok: true, resolvedPath: "C:\\videos\\good.mp4" };
        }
        if (kind === "image" && filePath === "C:\\imgs\\logo.png") {
          return { ok: true, resolvedPath: "C:\\imgs\\logo.png" };
        }
        return { ok: false, error: "Ruta no permitida" };
      }),
    };

    mocks.renderPreviewFrame.mockResolvedValue({ ok: true, dataUrl: "data:image/jpeg;base64,x" });
    registerVideoHandlers(pathSecurity);
    const handle = mocks.handlers.get("video:renderPreviewFrame");
    const result = await handle(
      {},
      {
        input_path: "good.mp4",
        operations: [{ mode: "image", image_path: "C:\\imgs\\logo.png" }],
      },
    );

    expect(result).toEqual({ ok: true, dataUrl: "data:image/jpeg;base64,x" });
    expect(mocks.renderPreviewFrame).toHaveBeenCalledTimes(1);
    const payload = mocks.renderPreviewFrame.mock.calls[0][0];
    expect(payload.input_path).toBe("C:\\videos\\good.mp4");
    expect(payload.input_root).toBe("C:\\videos");
    expect(payload.asset_roots).toEqual(["C:\\imgs"]);
    expect(payload.operations[0].image_path).toBe("C:\\imgs\\logo.png");
  });
});
