import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { IPC_INVOKE } from "../shared/ipc-channels.js";

const trustedSenderEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  tempRoot: "",
  execute: vi.fn(),
  processor: vi.fn(),
  binaries: vi.fn(),
  media: vi.fn(),
  paths: vi.fn(),
  readable: vi.fn(),
  outputs: vi.fn(),
  saveDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => mocks.tempRoot },
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
}));
vi.mock("../main/shared-state.js", () => ({
  getMainWindow: () => null,
  isDev: false,
  DEV_URL: "http://localhost:5173",
}));
vi.mock("../main/processing-run.js", () => ({
  executeProcessingRun: mocks.execute,
  cancelRun: async () => ({ success: true, idle: true }),
}));
vi.mock("../main/utils/paths.js", () => ({ validateMediaBinaries: mocks.binaries }));
vi.mock("../main/utils/processor-spawn.js", () => ({
  validateProcessorAvailableAsync: mocks.processor,
}));
vi.mock("../main/utils/dialog-history.js", () => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: mocks.saveDialog,
}));
vi.mock("../main/utils/video-cache.js", () => ({ probeVideo: vi.fn() }));
vi.mock("../main/utils/media-task-pool.js", () => ({ runMediaTask: async (fn) => fn() }));
vi.mock("../main/utils/restore-session-paths.js", () => ({ restoreSessionPaths: vi.fn() }));
vi.mock("../main/utils/process-media-validation.js", () => ({
  sanitizeBatchJobMedia: mocks.media,
}));
vi.mock("../main/utils/process-input-validation.js", () => ({
  findUnreadableInputsAsync: mocks.readable,
}));
vi.mock("../main/utils/process-output.js", () => ({
  validateBatchOutputPaths: mocks.paths,
  deriveOutputPath: (_directory, file) => file,
  findExistingOutputs: mocks.outputs,
}));

const { registerProcessHandlers } = await import("../main/handlers/process.js");
const { registerCompositionHandlers } = await import("../main/handlers/composition.js");
const { registerStabilizationHandlers } = await import("../main/handlers/stabilization.js");
const { registerEditorHandlers } = await import("../main/handlers/editor.js");
let media;
let security;
const video = {
  id: 0,
  input_path: "C:/video.mp4",
  output_path: "C:/out/video.mp4",
  video_duration: 1,
};
const cases = [
  [IPC_INVOKE.startProcessing, video],
  [
    IPC_INVOKE.startComposition,
    {
      id: -1,
      kind: "composition",
      output_path: "C:/out/composition.mp4",
      canvas: { width: 1920, height: 1080, fit: "contain" },
      composition_fps: 30,
      clips: [video, { ...video, id: 1 }],
    },
  ],
  [
    IPC_INVOKE.startStabilization,
    {
      ...video,
      id: -2,
      kind: "stabilization",
      stabilization: { intensity: "medium", edges: "zoom" },
    },
  ],
];
const composition = cases[1][1];
cases.push(
  [IPC_INVOKE.exportEditorComposition, composition],
  [IPC_INVOKE.renderEditorExactFrame, { ...composition, frame: { atUs: 0 } }],
  [IPC_INVOKE.createEditorPreviewProxy, composition],
);
const stages = ["processor", "media", "paths", "readable", "outputs"];

function start(channel, template) {
  const job = {
    ...template,
    input_path: media,
    output_path: path.join(mocks.tempRoot, "out.mp4"),
    ...(template.clips
      ? { clips: template.clips.map((clip) => ({ ...clip, input_path: media })) }
      : {}),
  };
  const handler = mocks.handlers.get(channel);
  if (channel === IPC_INVOKE.createEditorPreviewProxy)
    return handler(trustedSenderEvent, {
      source: { path: media, sizeBytes: fs.statSync(media).size, mtimeMs: null, durationUs: 1e6 },
    });
  if (
    channel === IPC_INVOKE.exportEditorComposition ||
    channel === IPC_INVOKE.renderEditorExactFrame
  )
    return handler(trustedSenderEvent, { manifest: [job], requestId: "frame" });
  return handler(trustedSenderEvent, [job]);
}

function cancel(channel) {
  if (
    channel === IPC_INVOKE.exportEditorComposition ||
    channel === IPC_INVOKE.renderEditorExactFrame
  )
    return mocks.handlers.get(IPC_INVOKE.cancelEditorExport)(trustedSenderEvent, {
      kind: channel === IPC_INVOKE.renderEditorExactFrame ? "frame" : "export",
    });
  return mocks.handlers.get(IPC_INVOKE.cancelProcessing)(trustedSenderEvent);
}

beforeEach(() => {
  mocks.tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-preparation-"));
  media = path.join(mocks.tempRoot, "input.mp4");
  fs.writeFileSync(media, "source");
  mocks.execute.mockReset().mockImplementation(async ({ jobs }) => ({
    success: true,
    outputs: jobs.map((job) => ({ index: job.id, output: job.output_path })),
  }));
  mocks.processor.mockReset().mockResolvedValue({ ok: true });
  mocks.binaries.mockReset().mockReturnValue({ ok: true });
  mocks.media.mockReset().mockImplementation(async (jobs) => jobs);
  mocks.paths.mockReset().mockResolvedValue();
  mocks.readable.mockReset().mockResolvedValue([]);
  mocks.outputs.mockReset().mockResolvedValue([]);
  mocks.saveDialog.mockReset().mockResolvedValue({
    canceled: false,
    filePath: path.join(mocks.tempRoot, "out.mp4"),
  });
  security = {
    getOutputDirectory: () => mocks.tempRoot,
    registerAllowedPath: vi.fn(),
    validateReadableFile: (filePath) => ({ ok: true, resolvedPath: filePath }),
  };
  registerProcessHandlers(security);
  registerCompositionHandlers(security);
  registerStabilizationHandlers(security);
  registerEditorHandlers(security);
});
afterEach(() => fs.rmSync(mocks.tempRoot, { recursive: true, force: true }));

describe("export preparation cancellation", () => {
  it.each(cases)("runs the shared checks for %s", async (channel, job) => {
    expect(await start(channel, job)).toMatchObject({ success: true });
    for (const stage of [...stages, "binaries"]) expect(mocks[stage]).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it.each(cases)("keeps the output collision contract for %s", async (channel, job) => {
    const existing = path.join(mocks.tempRoot, "out.mp4");
    mocks.outputs.mockResolvedValue([existing]);
    const result = await start(channel, job);
    if (channel.startsWith("editor:")) {
      expect(result.success).toBe(true);
      expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ overwrite: false }));
    } else {
      expect(result).toEqual({
        success: false,
        code: "output_exists",
        existingOutputs: [existing],
      });
      expect(mocks.execute).not.toHaveBeenCalled();
    }
  });

  it.each(cases)("rejects unreadable input before starting %s", async (channel, job) => {
    mocks.readable.mockResolvedValue([{ inputPath: media, code: "empty", message: "Empty input" }]);
    expect(await start(channel, job)).toMatchObject({ success: false });
    expect(mocks.outputs).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(cases.flatMap(([channel, job]) => stages.map((stage) => [channel, stage, job])))(
    "stops %s at the cancelled checkpoint %s",
    async (channel, stage, job) => {
      let release;
      mocks[stage].mockImplementationOnce(
        (...args) =>
          new Promise((resolve) => {
            release = () =>
              resolve(stage === "processor" ? { ok: true } : stage === "media" ? args[0] : []);
          }),
      );
      const pending = start(channel, job);
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      await cancel(channel);
      release();
      expect(await pending).toMatchObject({ success: false, cancelled: true });
      for (const next of stages.slice(stages.indexOf(stage) + 1))
        expect(mocks[next]).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it.each(cases)("does not supersede the replacement preparation of %s", async (channel, job) => {
    let release;
    mocks.outputs.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = start(channel, job);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await cancel(channel);
    expect(await start(channel, job)).toMatchObject({ success: true });
    release([]);
    expect(await old).toMatchObject({ success: false, cancelled: true });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it.each(cases)(
    "cancels %s between preparation resolution and run-start",
    async (channel, job) => {
      mocks.outputs.mockImplementationOnce(() => ({
        then(resolve) {
          resolve([]);
          queueMicrotask(() => void cancel(channel));
        },
      }));
      expect(await start(channel, job)).toMatchObject({ success: false, cancelled: true });
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it.each(cases)("discards a late validation error after cancelling %s", async (channel, job) => {
    let reject;
    mocks.media.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const pending = start(channel, job);
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    await cancel(channel);
    reject(new Error("Stale validation error"));
    expect(await pending).toMatchObject({ success: false, cancelled: true });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("keeps frame preparation current when only the export owner is cancelled", async () => {
    const releases = [];
    mocks.processor.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    );
    const frame = start(IPC_INVOKE.renderEditorExactFrame, composition);
    const exported = start(IPC_INVOKE.exportEditorComposition, composition);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    await cancel(IPC_INVOKE.exportEditorComposition);
    for (const release of releases) release({ ok: true });
    expect(await frame).toMatchObject({ success: true });
    expect(await exported).toMatchObject({ success: false, cancelled: true });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation during synchronous source validation", async () => {
    security.validateReadableFile = (filePath) => {
      void cancel(IPC_INVOKE.exportEditorComposition);
      return { ok: true, resolvedPath: filePath };
    };
    expect(await start(IPC_INVOKE.exportEditorComposition, composition)).toMatchObject({
      success: false,
      cancelled: true,
    });
    expect(mocks.processor).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
