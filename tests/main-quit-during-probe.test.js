import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  sendToRenderer: vi.fn(),
  startJobRun: vi.fn(async () => {
    throw new Error("startJobRun must not be reached before spawn stage");
  }),
  state: {
    quitting: false,
    tempRoot: "",
    interrupt: async () => {},
  },
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
  app: { isPackaged: false, getPath: () => mocks.state.tempRoot },
}));

vi.mock("../main/shared-state.js", () => ({
  getAppIsQuitting: () => mocks.state.quitting,
  setAppIsQuitting: (value) => {
    mocks.state.quitting = Boolean(value);
  },
  getMainWindow: () => null,
  isDev: true,
}));

vi.mock("../main/utils/paths.js", () => ({
  validateMediaBinaries: () => ({ ok: true }),
}));

vi.mock("../main/utils/processor-spawn.js", () => ({
  validateProcessorAvailableAsync: async () => ({ ok: true, command: "noop", args: [] }),
  buildProcessorChildEnv: (env) => env,
}));

vi.mock("../main/utils/job-worker.js", () => ({
  startJobRun: mocks.startJobRun,
}));

vi.mock("../main/utils/media-task-pool.js", () => ({
  setMediaProcessingActive: vi.fn(),
  waitForMediaTasksToDrain: () => mocks.state.interrupt("admission"),
}));

vi.mock("../main/utils/concurrency.js", () => ({
  runWithConcurrency: async (items, _limit, worker) => {
    const results = new Array(items.length);
    for (let idx = 0; idx < items.length; idx++) {
      results[idx] = await worker(items[idx], idx);
    }
    await mocks.state.interrupt("probe");
    return results;
  },
}));

vi.mock("../main/utils/video-cache.js", () => ({ probeVideo: vi.fn() }));
vi.mock("../main/utils/settings.js", () => ({ readSettings: () => ({}) }));
vi.mock("../main/utils/renderer.js", () => ({
  sendToRenderer: (...args) => mocks.sendToRenderer(...args),
}));
vi.mock("../main/utils/jobManifest.js", () => ({
  unwrapJobManifest: (jobs) => ({ jobs, manifest: null }),
  createProcessorManifest: (_manifest, jobs) => ({ jobs }),
}));
vi.mock("../main/utils/process-input-validation.js", () => ({
  findUnreadableInputsAsync: async () => [],
  translateProcessorErrorMessage: (err) => err,
}));
vi.mock("../main/utils/process-media-validation.js", () => ({
  sanitizeBatchJobMedia: async (jobs, _security, { outputDirectory }) =>
    jobs.map((job) => ({
      ...job,
      output_path: job.output_path || path.join(outputDirectory, "out.mp4"),
    })),
}));
vi.mock("../main/utils/kill-process-tree.js", () => ({
  killProcessTree: vi.fn(async () => {}),
}));

const { registerProcessHandlers } = await import("../main/handlers/process.js");
const { executeProcessingRun, cancelRun, hasActiveProcessing } =
  await import("../main/processing-run.js");

describe("cancel mid-flight", () => {
  let tempRoot;
  let writeFileSpy;
  let replacementRun;
  let replacementDir;

  const beruDirsLeft = () =>
    fs.readdirSync(tempRoot).filter((name) => name.startsWith("beru-jobs-"));

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-quit-probe-"));
    mocks.handlers.clear();
    mocks.sendToRenderer.mockClear();
    mocks.startJobRun.mockClear();
    mocks.state.quitting = false;
    mocks.state.tempRoot = tempRoot;
    mocks.state.interrupt = async () => {};
    replacementRun = null;
    replacementDir = null;

    writeFileSpy = vi
      .spyOn(fs.promises, "writeFile")
      .mockImplementation(async (target, contents) => {
        fs.writeFileSync(target, contents);
        await mocks.state.interrupt("write");
      });

    registerProcessHandlers({ getOutputDirectory: () => tempRoot });
  });

  afterEach(async () => {
    writeFileSpy.mockRestore();
    mocks.state.interrupt = async () => {};
    mocks.state.quitting = false;
    await cancelRun();
    if (replacementRun) await replacementRun;
    replacementRun = null;
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  it.each([
    ["admission", "quit"],
    ["probe", "quit"],
    ["write", "quit"],
    ["admission", "superseded"],
    ["probe", "superseded"],
    ["write", "superseded"],
  ])("cancels after %s on %s without touching another run's artifacts", async (stage, reason) => {
    mocks.state.interrupt =
      reason === "quit"
        ? async (s) => {
            if (s === stage) mocks.state.quitting = true;
          }
        : async (s) => {
            if (s !== stage) return;
            await cancelRun();
            mocks.state.interrupt = () => new Promise(() => {});
            replacementRun = executeProcessingRun({
              jobs: [
                {
                  input_path: "replacement.mp4",
                  output_path: path.join(tempRoot, "replacement.mp4"),
                },
              ],
              outputDirectory: tempRoot,
              spawnSpec: { ok: true, command: "noop", args: [] },
            });
          };

    const result = await mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);

    expect(result).toMatchObject({
      success: false,
      error: "Procesamiento cancelado",
      cancelled: true,
    });
    expect(mocks.startJobRun).not.toHaveBeenCalled();
    expect(writeFileSpy).toHaveBeenCalledTimes(stage === "write" ? 1 : 0);

    if (reason === "quit") {
      expect(hasActiveProcessing()).toBe(false);
      expect(beruDirsLeft()).toEqual([]);
    } else {
      await vi.waitFor(() => {
        expect(hasActiveProcessing()).toBe(true);
        expect(beruDirsLeft()).toHaveLength(1);
      });
      replacementDir = path.join(tempRoot, beruDirsLeft()[0]);
      expect(hasActiveProcessing()).toBe(true);
      expect(beruDirsLeft()).toEqual([path.basename(replacementDir)]);
      expect(fs.existsSync(replacementDir)).toBe(true);
    }
  });

  it("refuses to begin a processing run while app is quitting", async () => {
    mocks.state.quitting = true;
    const result = await mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    expect(result).toMatchObject({ success: false, cancelled: true });
    expect(hasActiveProcessing()).toBe(false);
    expect(mocks.sendToRenderer).not.toHaveBeenCalled();
    expect(mocks.startJobRun).not.toHaveBeenCalled();
    expect(beruDirsLeft()).toEqual([]);
  });
});
