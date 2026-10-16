import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { IPC_EVENTS, IPC_INVOKE, emitRunEvent } from "../shared/ipc-channels.js";
import { createProcessingRun } from "../src/utils/processing-run.js";

const trustedSenderEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

const mocks = vi.hoisted(() => ({
  sendToRenderer: vi.fn(),
  emitLine: null,
  resolveDone: null,
  proc: null,
  tempRoot: "",
  handlers: new Map(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
  app: { isPackaged: false, getPath: () => mocks.tempRoot },
}));

vi.mock("../main/shared-state.js", () => ({
  getAppIsQuitting: () => false,
  isDev: false,
  DEV_URL: "http://localhost:5173",
}));
vi.mock("../main/utils/paths.js", () => ({ validateMediaBinaries: () => ({ ok: true }) }));
vi.mock("../main/utils/processor-spawn.js", () => ({
  validateProcessorAvailableAsync: async () => ({ ok: true, command: "noop", args: [] }),
}));
vi.mock("../main/utils/job-worker.js", () => ({
  startJobRun: vi.fn(async ({ onLine, jobsFile }) => {
    mocks.jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8")).jobs;
    mocks.emitLine = onLine;
    return {
      proc: mocks.proc,
      done: new Promise((resolve) => {
        mocks.resolveDone = resolve;
      }),
      stderrTail: () => "",
    };
  }),
}));
vi.mock("../main/utils/media-task-pool.js", () => ({
  setMediaProcessingActive: vi.fn(),
  waitForMediaTasksToDrain: async () => {},
}));
vi.mock("../main/utils/video-cache.js", () => ({ probeVideo: vi.fn(async () => ({})) }));
vi.mock("../main/utils/settings.js", () => ({ readSettings: () => ({}) }));
vi.mock("../main/utils/renderer.js", () => ({
  sendToRenderer: (...args) => mocks.sendToRenderer(...args),
}));
vi.mock("../main/utils/kill-process-tree.js", () => ({
  killProcessTree: vi.fn(async () => {}),
}));
vi.mock("../main/utils/jobManifest.js", () => ({
  unwrapJobManifest: (jobs) => ({ jobs, manifest: null }),
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

const runModule = await import("../main/processing-run.js");
const { registerProcessHandlers } = await import("../main/handlers/process.js");

function fakeProc() {
  const proc = new EventEmitter();
  proc.pid = 9200;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
  proc.kill = vi.fn(() => true);
  return proc;
}

const calls = (channel) => mocks.sendToRenderer.mock.calls.filter(([c]) => c === channel);

beforeEach(() => {
  mocks.proc = fakeProc();
  mocks.emitLine = null;
  mocks.resolveDone = null;
  mocks.sendToRenderer.mockReset();
  mocks.tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-warning-test-"));
  registerProcessHandlers({ getOutputDirectory: () => mocks.tempRoot });
});

afterEach(async () => {
  await runModule.cancelRun();
  vi.restoreAllMocks();
  try {
    fs.rmSync(mocks.tempRoot, { recursive: true, force: true });
  } catch {}
});

describe("processor warning events", () => {
  it("forwards warning NDJSON to the renderer without failing the run", async () => {
    const outputDir = mocks.tempRoot;
    const pending = mocks.handlers.get(IPC_INVOKE.startProcessing)(trustedSenderEvent, [
      { id: 5, input_path: "in.mp4", output_path: path.join(outputDir, "5.mp4") },
    ]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    mocks.emitLine(
      JSON.stringify({
        type: "warning",
        index: 5,
        code: "patch_skipped_timing",
        message: "Reconstrucción temporal omitida",
      }),
    );
    fs.writeFileSync(mocks.jobs[0].output_path, "exported");
    mocks.emitLine(JSON.stringify({ type: "complete", index: 5 }));
    mocks.resolveDone({ ok: true });
    const result = await pending;

    expect(result.success).toBe(true);
    const warningCalls = calls(IPC_EVENTS.onRunWarning);
    expect(warningCalls).toHaveLength(1);
    const [, payload] = warningCalls[0];
    expect(payload.code).toBe("patch_skipped_timing");
    expect(payload.index).toBe(5);
    expect(payload.message).toBe("Reconstrucción temporal omitida");
    expect(payload.runId).toBe(result.runId);
    expect(calls(IPC_EVENTS.onFinished)[0][1]).toMatchObject({ code: 0 });
  });

  it("keeps rendering warnings run-scoped like every other event", async () => {
    const pending = mocks.handlers.get(IPC_INVOKE.startProcessing)(trustedSenderEvent, [
      { id: 2, input_path: "b.mp4" },
    ]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    mocks.emitLine(
      JSON.stringify({
        type: "warning",
        index: 2,
        code: "patch_skipped_budget",
        message: "Reconstrucción temporal omitida",
      }),
    );
    fs.writeFileSync(mocks.jobs[0].output_path, "exported");
    mocks.emitLine(JSON.stringify({ type: "complete", index: 2 }));
    mocks.resolveDone({ ok: true });
    await pending;
    const started = mocks.sendToRenderer.mock.calls.filter(([c]) => c === IPC_EVENTS.onRunStarted);
    const runId = started[0][1].runId;
    for (const [, payload] of calls(IPC_EVENTS.onRunWarning)) {
      expect(payload.runId).toBe(runId);
    }
  });
});

describe("renderer onRunWarning", () => {
  function rendererHarness() {
    let state = {
      queue: [],
      isProcessing: true,
      activeProcessRunId: "run-1",
      language: "es",
      showToast: vi.fn(),
    };
    const set = (patch) => {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    };
    const run = createProcessingRun(set, () => state);
    const events = new Map();
    run.connect({
      ...Object.fromEntries(
        Object.entries(IPC_EVENTS).map(([name, channel]) => [
          name,
          (handler) => {
            events.set(channel, handler);
            return () => events.delete(channel);
          },
        ]),
      ),
    });
    return { events, state: () => state };
  }

  it("shows a localized warning toast for known codes", () => {
    const { events, state } = rendererHarness();
    const handler = events.get("process:runWarning");
    expect(typeof handler).toBe("function");
    handler({ runId: "run-1", index: 0, code: "patch_skipped_timing", message: "raw" });
    expect(state().showToast).toHaveBeenCalledTimes(1);
    const toast = state().showToast.mock.calls[0][0];
    expect(toast.kind).toBe("warn");
    expect(toast.text).toContain("timestamps irregulares");
  });

  it("falls back to the processor message for unknown codes", () => {
    const { events, state } = rendererHarness();
    events.get("process:runWarning")({
      runId: "run-1",
      code: "patch_whatever",
      message: "raw msg",
    });
    const toast = state().showToast.mock.calls[0][0];
    expect(toast.kind).toBe("warn");
    expect(toast.text).toBe("raw msg");
  });
});

describe("emitRunEvent contract", () => {
  it("onRunWarning maps to the process:runWarning channel", () => {
    expect(IPC_EVENTS.onRunWarning).toBe("process:runWarning");
    const send = vi.fn();
    emitRunEvent(send, IPC_EVENTS.onRunWarning, "run-7", { code: "patch_skipped_budget" });
    expect(send).toHaveBeenCalledWith("process:runWarning", {
      code: "patch_skipped_budget",
      runId: "run-7",
    });
  });
});
