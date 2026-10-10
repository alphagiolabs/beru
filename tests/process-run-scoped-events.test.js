import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { IPC_EVENTS, IPC_INVOKE, emitRunEvent } from "../shared/ipc-channels.js";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  sendToRenderer: vi.fn(),
  killProcessTree: vi.fn(async () => {}),
  proc: null,
  done: null,
  resolveDone: null,
  emitLine: null,
  tempRoot: "",
  jobs: [],
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
  app: { isPackaged: false, getPath: () => mocks.tempRoot },
}));

vi.mock("../main/shared-state.js", () => ({ getAppIsQuitting: () => false }));
vi.mock("../main/utils/paths.js", () => ({ validateMediaBinaries: () => ({ ok: true }) }));
vi.mock("../main/utils/processor-spawn.js", () => ({
  validateProcessorAvailableAsync: async () => ({ ok: true, command: "noop", args: [] }),
}));
vi.mock("../main/utils/job-worker.js", () => ({
  startJobRun: vi.fn(async ({ onLine, jobsFile }) => {
    mocks.jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8")).jobs;
    mocks.emitLine = onLine;
    return { proc: mocks.proc, done: mocks.done, stderrTail: () => "" };
  }),
}));
vi.mock("../main/utils/media-task-pool.js", () => ({
  setMediaProcessingActive: vi.fn(),
  waitForMediaTasksToDrain: async () => {},
}));
vi.mock("../main/utils/concurrency.js", () => ({
  runWithConcurrency: async (items, limit, worker) => {
    const results = new Array(items.length);
    let cursor = 0;
    const launch = async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        results[idx] = await worker(items[idx], idx);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, launch));
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
  translateProcessorErrorMessage: (m) => m,
}));
vi.mock("../main/utils/process-media-validation.js", () => ({
  sanitizeBatchJobMedia: async (jobs, _security, { outputDirectory }) =>
    jobs.map((job) => ({
      ...job,
      output_path: job.output_path || path.join(outputDirectory, "out.mp4"),
    })),
}));
vi.mock("../main/utils/kill-process-tree.js", () => ({
  killProcessTree: (...args) => mocks.killProcessTree(...args),
}));

const { registerProcessHandlers } = await import("../main/handlers/process.js");
const runModule = await import("../main/processing-run.js");

let tmpDirs = [];

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-runscope-test-"));
  tmpDirs.push(dir);
  return dir;
}

function fakeProc(pid = 9100) {
  const proc = new EventEmitter();
  proc.pid = pid;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    return true;
  });
  return proc;
}

const calls = (channel) => mocks.sendToRenderer.mock.calls.filter(([c]) => c === channel);

beforeEach(() => {
  mocks.tempRoot = tmpDir();
  mocks.proc = fakeProc();
  mocks.done = new Promise((resolve) => {
    mocks.resolveDone = resolve;
  });
  mocks.emitLine = null;
  mocks.sendToRenderer.mockClear();
  registerProcessHandlers({ getOutputDirectory: () => tmpDir() });
});

afterEach(async () => {
  await runModule.cancelRun();
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tmpDirs = [];
});

describe("run-scoped process events", () => {
  it("emitRunEvent stamps runId onto the payload", () => {
    const send = vi.fn();
    emitRunEvent(send, IPC_EVENTS.onProgress, "run-1", { percent: 50 });
    expect(send).toHaveBeenCalledWith(IPC_EVENTS.onProgress, { percent: 50, runId: "run-1" });
    emitRunEvent(send, IPC_EVENTS.onRunStarted, "run-2");
    expect(send).toHaveBeenLastCalledWith(IPC_EVENTS.onRunStarted, { runId: "run-2" });
  });

  it("every event a run emits is run-scoped and carries that run's runId", async () => {
    const outputDir = tmpDir();
    const pending = mocks.handlers.get(IPC_INVOKE.startProcessing)({}, [
      { input_path: "a.mp4", output_path: path.join(outputDir, "a.mp4") },
    ]);

    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    mocks.emitLine('{"type":"progress","index":0,"percent":10}');
    mocks.emitLine('{"type":"job_progress","index":0,"percent":20}');
    fs.writeFileSync(mocks.jobs[0].output_path, "exported");
    mocks.emitLine('{"type":"complete","index":0}');
    mocks.emitLine('{"type":"summary","done":1}');
    mocks.resolveDone({ ok: true });
    await pending;

    const started = calls(IPC_EVENTS.onRunStarted);
    expect(started).toHaveLength(1);
    const runId = started[0][1].runId;
    expect(runId).toBeTruthy();

    const emitted = mocks.sendToRenderer.mock.calls;
    expect(emitted.length).toBeGreaterThanOrEqual(6);
    for (const [channel, payload] of emitted) {
      expect(channel.startsWith("process:"), `channel ${channel}`).toBe(true);
      expect(payload.runId, `payload of ${channel}`).toBe(runId);
    }
    expect(calls(IPC_EVENTS.onFinished)[0][1]).toMatchObject({ code: 0, runId });
  });

  it.each([
    { type: "cancelled", index: 7 },
    { type: "error", index: 7, error: "Cancelled" },
  ])("forwards $type job cancellation through its run-scoped IPC channel", async (message) => {
    const pending = mocks.handlers.get(IPC_INVOKE.startProcessing)({}, [
      { id: 7, input_path: "clip.mp4" },
    ]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    mocks.emitLine(JSON.stringify(message));
    mocks.resolveDone({ ok: true });
    const result = await pending;
    expect(calls(IPC_EVENTS.onJobCancelled)).toHaveLength(1);
    expect(calls(IPC_EVENTS.onJobCancelled)[0][1]).toMatchObject({
      type: "cancelled",
      index: 7,
      runId: result.runId,
    });
    expect(calls(IPC_EVENTS.onJobError)).toHaveLength(0);
    expect(calls(IPC_EVENTS.onError)).toHaveLength(0);
  });
});
