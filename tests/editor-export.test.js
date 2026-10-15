import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { IPC_EVENTS, IPC_INVOKE } from "../shared/ipc-channels.js";

const trustedEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

const mocks = vi.hoisted(() => ({
  tempRoot: "",
  handlers: new Map(),
  openDialog: vi.fn(),
  saveDialog: vi.fn(),
  probe: vi.fn(),
  executeProcessingRun: vi.fn(),
  cancelRun: vi.fn(async () => ({ success: true, idle: true })),
}));
vi.mock("../main/utils/dialog-history.js", () => ({
  showOpenDialog: mocks.openDialog,
  showSaveDialog: mocks.saveDialog,
}));
vi.mock("../main/utils/video-cache.js", () => ({
  probeVideo: mocks.probe,
  probeVideoFast: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => mocks.tempRoot },
  dialog: {},
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
}));
vi.mock("../main/utils/processor-spawn.js", () => ({
  validateProcessorAvailableAsync: async () => ({
    ok: true,
    command: "python",
    args: ["processor.py"],
  }),
}));
vi.mock("../main/utils/paths.js", async (importOriginal) => ({
  ...(await importOriginal()),
  validateMediaBinaries: () => ({ ok: true }),
}));
vi.mock("../main/shared-state.js", () => ({
  getMainWindow: () => null,
  isDev: false,
  DEV_URL: null,
}));
vi.mock("../main/processing-run.js", () => ({
  executeProcessingRun: mocks.executeProcessingRun,
  cancelRun: mocks.cancelRun,
}));
vi.mock("../main/utils/media-task-pool.js", () => ({ runMediaTask: async (fn) => fn() }));
const { previewProxyName, pruneProxies, registerEditorHandlers, sourceDescriptor } =
  await import("../main/handlers/editor.js");
const { identityChanged } = await import("../main/utils/editor-document-io.js");
function manifestFor(outputPath) {
  return {
    type: "beru-job-manifest",
    version: 1,
    jobs: [
      {
        id: -1,
        kind: "composition",
        canvas: { width: 320, height: 240, fit: "contain", background: "#000000" },
        composition_fps: 30,
        encode_profile: "balanced",
        clips: [
          {
            input_path: "C:/Videos/a.mp4",
            video_duration: 1,
            trim_start: 0,
            trim_end: 1,
            playback_rate: 1,
          },
        ],
        output_path: outputPath,
      },
    ],
  };
}

beforeEach(() => {
  mocks.executeProcessingRun.mockReset().mockImplementation(async ({ jobs }) => {
    const output = jobs[0].output_path;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, "rendered");
    return { success: true, runId: "test" };
  });
});

describe("shared processing lifecycle", () => {
  let tmp, media, security;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beru-editor-run-"));
    mocks.tempRoot = tmp;
    media = path.join(tmp, "a.mov");
    fs.writeFileSync(media, "source");
    security = {
      validateReadableFile: (p) => ({ ok: true, resolvedPath: p }),
      validateReadableFileAsync: async (p) => ({ ok: true, resolvedPath: p }),
    };
    mocks.handlers.clear();
    registerEditorHandlers(security);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
  it("runs export, frame and proxy as canonical composition jobs in Processing Run", async () => {
    const manifest = manifestFor(path.join(tmp, "out.mp4"));
    manifest.jobs[0].clips[0].input_path = media;
    mocks.saveDialog.mockResolvedValue({ canceled: false, filePath: path.join(tmp, "out.mp4") });
    const exported = await mocks.handlers.get(IPC_INVOKE.exportEditorComposition)(trustedEvent, {
      manifest,
    });
    expect(exported.success).toBe(true);
    expect(mocks.executeProcessingRun.mock.calls[0][0]).toMatchObject({
      owner: "editor:export",
      events: { [IPC_EVENTS.onJobProgress]: IPC_EVENTS.onEditorExportProgress },
      jobs: [{ kind: "composition", clips: [{ input_path: media }] }],
    });
    manifest.jobs[0].frame = { atUs: 500000 };
    expect(
      (
        await mocks.handlers.get(IPC_INVOKE.renderEditorExactFrame)(trustedEvent, {
          manifest,
          requestId: "frame-1",
        })
      ).success,
    ).toBe(true);
    expect(mocks.executeProcessingRun.mock.calls[1][0]).toMatchObject({
      owner: "editor:frame",
      events: {},
      jobs: [{ frame: { atUs: 500000 } }],
    });
    const stat = fs.statSync(media),
      source = { path: media, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, durationUs: 1e6 };
    const proxy = await mocks.handlers.get(IPC_INVOKE.createEditorPreviewProxy)(trustedEvent, {
      source,
    });
    expect(proxy.success).toBe(true);
    expect(mocks.executeProcessingRun.mock.calls[2][0]).toMatchObject({
      owner: "editor:proxy",
      events: {},
      jobs: [
        {
          kind: "composition",
          composition_fps: 30,
          canvas: { width: 960, height: 540 },
          clips: [{ input_path: media, trim_start: 0, trim_end: 1 }],
        },
      ],
    });
    expect(
      await mocks.handlers.get(IPC_INVOKE.createEditorPreviewProxy)(trustedEvent, { source }),
    ).toEqual({
      ...proxy,
      reused: true,
    });
    expect(mocks.executeProcessingRun).toHaveBeenCalledTimes(3);
  });
  it("does not delete a published frame when another request cannot acquire the shared run", async () => {
    const manifest = manifestFor(path.join(tmp, "x.png"));
    manifest.jobs[0].clips[0].input_path = media;
    manifest.jobs[0].frame = { atUs: 0 };
    const handler = mocks.handlers.get(IPC_INVOKE.renderEditorExactFrame);
    const first = await handler(trustedEvent, { manifest, requestId: "first" });
    expect(first.success).toBe(true);
    mocks.executeProcessingRun.mockResolvedValueOnce({
      success: false,
      code: "already_processing",
    });
    const second = await handler(trustedEvent, { manifest, requestId: "second" });
    expect(second.success).toBe(false);
    expect(fs.existsSync(first.path)).toBe(true);
    const third = await handler(trustedEvent, { manifest, requestId: "third" });
    expect(third.success).toBe(true);
    expect(fs.existsSync(first.path)).toBe(false);
    expect(fs.existsSync(third.path)).toBe(true);
  });
  it("cancels only the requested Editor owner through the shared lifecycle", async () => {
    const cancel = mocks.handlers.get(IPC_INVOKE.cancelEditorExport);
    await cancel(trustedEvent, { kind: "frame" });
    expect(mocks.cancelRun).toHaveBeenLastCalledWith({ owner: "editor:frame" });
    await cancel(trustedEvent, {});
    expect(mocks.cancelRun).toHaveBeenLastCalledWith({ owner: "editor:export" });
  });
  it("invalidates a proxy when its source identity changed", async () => {
    const result = await mocks.handlers.get(IPC_INVOKE.createEditorPreviewProxy)(trustedEvent, {
      source: { path: media, sizeBytes: 999, mtimeMs: null, durationUs: 1e6 },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cambió/);
    expect(mocks.executeProcessingRun).not.toHaveBeenCalled();
  });
  it("keeps the most recently used proxies", async () => {
    const dir = path.join(tmp, "proxies");
    fs.mkdirSync(dir);
    for (const [i, name] of ["old", "mid", "new"].entries()) {
      const file = path.join(dir, name + ".mp4");
      fs.writeFileSync(file, "p");
      const time = new Date(Date.now() - (3 - i) * 60000);
      fs.utimesSync(file, time, time);
    }
    await pruneProxies(dir, 2);
    expect(fs.readdirSync(dir).sort()).toEqual(["mid.mp4", "new.mp4"]);
  });
  it("keys proxies by source identity", () => {
    const source = { path: "C:/Videos/a.mov", sizeBytes: 10, mtimeMs: 5 };
    expect(previewProxyName(source)).not.toBe(previewProxyName({ ...source, sizeBytes: 11 }));
  });
});

describe("import and export handlers", () => {
  let tmp;
  let media;
  let pathSecurity;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beru-handlers-"));
    mocks.tempRoot = tmp;
    media = path.join(tmp, "clip.mp4");
    fs.writeFileSync(media, Buffer.alloc(256, 3));
    pathSecurity = {
      registerSelectedPath: (filePath) => ({ ok: true, resolvedPath: filePath }),
      validateReadableFile: () => ({ ok: true, resolvedPath: media }),
    };
    pathSecurity.validateReadableFileAsync = async (...args) =>
      pathSecurity.validateReadableFile(...args);
    mocks.handlers.clear();
    mocks.openDialog.mockReset();
    mocks.saveDialog.mockReset();
    mocks.probe.mockReset();
    mocks.executeProcessingRun.mockClear();
    registerEditorHandlers(pathSecurity);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("imports dropped paths as sources with identity, and reports unreadable ones", async () => {
    const broken = path.join(tmp, "broken.mp4");
    fs.writeFileSync(broken, "x");
    mocks.probe.mockImplementation(async (filePath) =>
      filePath === broken
        ? { duration: 0, width: 0, height: 0, audioCodec: "" }
        : { duration: 4.5, width: 1280, height: 720, audioCodec: "aac" },
    );
    const result = await mocks.handlers.get(IPC_INVOKE.importEditorVideos)(trustedEvent, {
      paths: [media, broken],
    });
    expect(result.success).toBe(true);
    expect(result.sources).toEqual([
      expect.objectContaining({
        path: media,
        filename: "clip.mp4",
        sizeBytes: 256,
        metadata: { durationUs: 4_500_000, width: 1280, height: 720, hasAudio: true },
      }),
    ]);
    expect(result.errors).toEqual([{ path: broken, error: "No se pudo leer el video" }]);
  });

  it("asks for files through the dialog when no paths are dropped", async () => {
    mocks.openDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await mocks.handlers.get(IPC_INVOKE.importEditorVideos)(trustedEvent, undefined);
    expect(mocks.openDialog).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: false, canceled: true });
  });

  it("does not start an export when the user cancels the destination dialog", async () => {
    mocks.saveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    const manifest = manifestFor(path.join(tmp, "unused.mp4"));
    manifest.jobs[0].clips[0].input_path = media;
    const result = await mocks.handlers.get(IPC_INVOKE.exportEditorComposition)(trustedEvent, {
      manifest,
    });
    expect(result).toEqual({ success: false, canceled: true });
    expect(mocks.executeProcessingRun).not.toHaveBeenCalled();
  });

  it("refuses an output path that would overwrite a montage source", async () => {
    mocks.saveDialog.mockResolvedValue({ canceled: false, filePath: media });
    const manifest = manifestFor(path.join(tmp, "unused.mp4"));
    manifest.jobs[0].clips[0].input_path = media;
    const result = await mocks.handlers.get(IPC_INVOKE.exportEditorComposition)(trustedEvent, {
      manifest,
    });
    expect(result.error).toMatch(/no puede reemplazar una fuente/);
    expect(mocks.executeProcessingRun).not.toHaveBeenCalled();
  });

  it("validates the manifest before touching any file or dialog", async () => {
    const manifest = manifestFor(path.join(tmp, "unused.mp4"));
    manifest.jobs[0].clips = [];
    const result = await mocks.handlers.get(IPC_INVOKE.exportEditorComposition)(trustedEvent, {
      manifest,
    });
    expect(result).toEqual({ success: false, error: "La composición no tiene clips" });
    expect(mocks.saveDialog).not.toHaveBeenCalled();
  });

  it("imports a still image with its size and no duration, under the image consent kind", async () => {
    const image = path.join(tmp, "logo.png");
    fs.writeFileSync(image, Buffer.alloc(64, 1));
    const kinds = [];
    pathSecurity.registerSelectedPath = (filePath, kind) => {
      kinds.push(kind);
      return { ok: true, resolvedPath: filePath };
    };
    mocks.openDialog.mockResolvedValue({ canceled: false, filePaths: [image] });
    mocks.probe.mockResolvedValue({ duration: 0, width: 40, height: 40, audioCodec: "" });
    const result = await mocks.handlers.get(IPC_INVOKE.importEditorImage)(trustedEvent);
    expect(kinds).toEqual(["image"]);
    expect(result).toEqual({
      success: true,
      source: expect.objectContaining({
        path: image,
        filename: "logo.png",
        sizeBytes: 64,
        metadata: { durationUs: null, width: 40, height: 40, hasAudio: false },
      }),
    });
  });

  it("refuses an image the probe cannot size", async () => {
    const image = path.join(tmp, "broken.png");
    fs.writeFileSync(image, "x");
    mocks.openDialog.mockResolvedValue({ canceled: false, filePaths: [image] });
    mocks.probe.mockResolvedValue({ duration: 0, width: 0, height: 0, audioCodec: "" });
    const result = await mocks.handlers.get(IPC_INVOKE.importEditorImage)(trustedEvent);
    expect(result).toEqual({ success: false, error: "No se pudo leer la imagen" });
  });

  it("probes a relinked video, so the document can check its duration against the clips", async () => {
    mocks.openDialog.mockResolvedValue({ canceled: false, filePaths: [media] });
    mocks.probe.mockResolvedValue({ duration: 2, width: 640, height: 360, audioCodec: "" });
    const result = await mocks.handlers.get(IPC_INVOKE.pickEditorReplacement)(trustedEvent, {
      kind: "video",
    });
    expect(result).toEqual({
      success: true,
      source: expect.objectContaining({
        path: media,
        metadata: { durationUs: 2_000_000, width: 640, height: 360, hasAudio: false },
      }),
    });
  });

  it("checks the still image of a layer under the image consent kind before exporting", async () => {
    const logo = path.join(tmp, "logo.png");
    fs.writeFileSync(logo, Buffer.alloc(64, 1));
    pathSecurity.validateReadableFile = (filePath, kind) =>
      kind === "image"
        ? { ok: false, error: "Tipo de archivo no permitido" }
        : { ok: true, resolvedPath: media };
    const manifest = manifestFor(path.join(tmp, "unused.mp4"));
    manifest.jobs[0].clips[0].input_path = media;
    manifest.jobs[0].overlays = [
      {
        id: "logo",
        kind: "image",
        startUs: 0,
        endUs: 1_000_000,
        geometry: { x: 0.7, y: 0.05, w: 0.25, h: 0.25 },
        source: { path: logo, sizeBytes: 64, mtimeMs: fs.statSync(logo).mtimeMs },
      },
    ];
    const result = await mocks.handlers.get(IPC_INVOKE.exportEditorComposition)(trustedEvent, {
      manifest,
    });
    expect(result).toEqual({
      success: false,
      error: "No se puede leer logo.png: Tipo de archivo no permitido",
    });
    expect(mocks.saveDialog).not.toHaveBeenCalled();
  });
});

describe("export helpers", () => {
  it("describes an imported source with its identity and probed metadata", () => {
    const descriptor = sourceDescriptor(
      "C:/Videos/a.mp4",
      { size: 2048, mtimeMs: 1700000000000.4 },
      { duration: 8.5, width: 1920, height: 1080, audioCodec: "aac" },
    );
    expect(descriptor).toEqual({
      path: "C:/Videos/a.mp4",
      filename: "a.mp4",
      sizeBytes: 2048,
      mtimeMs: 1700000000000.4,
      metadata: { durationUs: 8_500_000, width: 1920, height: 1080, hasAudio: true },
    });
  });

  it("detects a source whose size or modification time moved since import", () => {
    const identity = { sizeBytes: 100, mtimeMs: 1000 };
    expect(identityChanged(identity, { size: 100, mtimeMs: 1000.2 })).toBe(false);
    expect(identityChanged(identity, { size: 101, mtimeMs: 1000 })).toBe(true);
    expect(identityChanged(identity, { size: 100, mtimeMs: 2000 })).toBe(true);
    expect(identityChanged({ sizeBytes: null, mtimeMs: null }, { size: 1, mtimeMs: 1 })).toBe(
      false,
    );
  });
});
