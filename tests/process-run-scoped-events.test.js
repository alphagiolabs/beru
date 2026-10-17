import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { spawnSync } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { IPC_EVENTS, IPC_INVOKE, emitRunEvent } from "../shared/ipc-channels.js";
import { createProcessingRun } from "../src/utils/processing-run.js";
import { RUN_EVENTS, RUN_WARNING_KEYS, WORKER_EVENTS } from "../shared/run-events.js";
import es from "../src/i18n/messages/es.json";
import en from "../src/i18n/messages/en.json";

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

const trustedSenderEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

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
  mocks.sendToRenderer.mockReset();
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
  it.each([
    ["composition", -1],
    ["stabilization", -2],
  ])("keeps the renderer busy until a failed %s worker finishes", async (kind, id) => {
    const outputDirectory = tmpDir(),
      job = { kind, id, output_path: "out.mp4", video_info_probed: true };
    let state = {
      queue: [],
      isProcessing: false,
      jobProgress: {},
      exportSignatures: {},
      showToast: vi.fn(),
    };
    const events = new Map(),
      set = (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      };
    const renderer = createProcessingRun(set, () => state);
    const api = {
      ...Object.fromEntries(
        Object.entries(IPC_EVENTS).map(([name, channel]) => [
          name,
          (handler) => {
            events.set(channel, handler);
            return () => events.delete(channel);
          },
        ]),
      ),
      startProcessing: (manifest) =>
        runModule.executeProcessingRun({
          manifest,
          jobs: manifest.jobs,
          outputDirectory,
          spawnSpec: { command: "noop", args: [] },
        }),
    };
    const prepare = () => ({
      ok: true,
      jobs: [job],
      manifest: { jobs: [job] },
      startPatch: {
        queue: state.queue,
        isProcessing: true,
        mediaExport: { kind, jobId: id, status: "processing", progress: 0 },
      },
    });
    mocks.sendToRenderer.mockImplementation((channel, payload) => events.get(channel)?.(payload));
    const disconnect = renderer.connect(api),
      pending = renderer.start(api, prepare(), id);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    try {
      mocks.emitLine(JSON.stringify({ type: "error", index: id, error: "Invalid media" }));
      expect(state.mediaExport).toMatchObject({ status: "error", error: "Invalid media" });
      expect(state.isProcessing).toBe(true);
      expect(calls(IPC_EVENTS.onError)).toHaveLength(0);
      expect(await renderer.start(api, prepare(), id)).toMatchObject({
        ok: false,
        code: "already_processing",
      });
    } finally {
      mocks.proc.exitCode = 1;
      mocks.resolveDone({ ok: false });
      await pending;
    }
    expect(state.isProcessing).toBe(false);
    expect(state.activeProcessingKind).toBeNull();
    expect(state.mediaExport.summary).toMatchObject({ total: 1, failed: 1 });
    mocks.proc = fakeProc(9101);
    mocks.done = new Promise((resolve) => {
      mocks.resolveDone = resolve;
    });
    const next = renderer.start(api, prepare(), id);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    fs.writeFileSync(mocks.jobs[0].output_path, "exported");
    mocks.emitLine(JSON.stringify({ type: "complete", index: id }));
    mocks.resolveDone({ ok: true });
    expect(await next).toMatchObject({ ok: true });
    expect(state.isProcessing).toBe(false);
    disconnect();
  });

  it("emitRunEvent stamps runId onto the payload", () => {
    const send = vi.fn();
    emitRunEvent(send, IPC_EVENTS.onProgress, "run-1", { percent: 50 });
    expect(send).toHaveBeenCalledWith(IPC_EVENTS.onProgress, { percent: 50, runId: "run-1" });
    emitRunEvent(send, IPC_EVENTS.onRunStarted, "run-2");
    expect(send).toHaveBeenLastCalledWith(IPC_EVENTS.onRunStarted, { runId: "run-2" });
  });

  it("routes real Python event payloads through main and renderer against the shared contract", async () => {
    const result = spawnSync(
      process.env.BERU_PYTHON || "python",
      [
        "-B",
        "-c",
        `
import ast, io, json, sys
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, "python")
import ffmpeg_runner as events
import processor
import temporal_pipeline
from test_job_worker import _run_worker, _stdin_with

summary = processor.process_jobs([], "unused", max_workers=1, hw_encoder=None)
output = io.StringIO()
with redirect_stdout(output):
    events.emit_batch_progress({"completed": 1, "succeeded": 1, "failed": 0}, 3, "a.mp4")
    events._emit_job_progress(0, 100, None)
    for code in temporal_pipeline._PATCH_SKIP_MESSAGES:
        temporal_pipeline.TemporalPatchResolver._warn_patch_skipped(
            SimpleNamespace(job_id=0, _defer_reason=code))
    events.emit_job_complete(0, "out.mp4")
    events.emit_job_failed({"index": 1, "error": "Invalid media"})
    events.job_cancelled_result(2)
with patch.object(processor, "_load_jobs_manifest", return_value=[]):
    lines, _, _ = _run_worker(_stdin_with(
        {"id": 1, "jobs_file": "unused.json"}, {"id": 2, "jobs_file": 7}),
        process_jobs=lambda *a, **k: {**summary, "total": 3, "succeeded": 1, "failed": 1, "cancelled": 1})

types = set()
for name in ("ffmpeg_runner.py", "processor.py"):
    for node in ast.walk(ast.parse(Path("python", name).read_text(encoding="utf-8"))):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if (isinstance(key, ast.Constant) and key.value == "type"
                        and isinstance(value, ast.Constant) and isinstance(value.value, str)):
                    types.add(value.value)
print(json.dumps({"events": [json.loads(line) for line in output.getvalue().splitlines()] + lines,
                  "types": sorted(types), "warnings": list(temporal_pipeline._PATCH_SKIP_MESSAGES)}))
`,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(result.status, result.stderr || result.error?.message).toBe(0);
    const producer = JSON.parse(result.stdout);
    const contracts = Object.values(RUN_EVENTS);
    expect(producer.types).toEqual(
      [...contracts.map((event) => event.type), ...Object.values(WORKER_EVENTS)].sort(),
    );
    const messages = producer.events.filter(
      (msg) => !Object.values(WORKER_EVENTS).includes(msg.type),
    );
    expect([...new Set(messages.map((msg) => msg.type))].sort()).toEqual(
      contracts.map((event) => event.type).sort(),
    );
    for (const msg of messages) {
      const contract = contracts.find((event) => event.type === msg.type);
      for (const field of contract.requiredFields)
        expect(msg, `${msg.type}.${field}`).toHaveProperty(field);
    }
    expect(producer.warnings.sort()).toEqual(Object.keys(RUN_WARNING_KEYS).sort());
    for (const key of Object.values(RUN_WARNING_KEYS)) {
      expect(es).toHaveProperty(key);
      expect(en).toHaveProperty(key);
    }

    const outputDir = tmpDir();
    const jobs = ["a", "b", "c"].map((name, id) => ({
      id,
      input_path: `${name}.mp4`,
      output_path: path.join(outputDir, `${name}.mp4`),
      video_info_probed: true,
    }));
    let state = {
      queue: jobs.map((job) => ({ path: job.input_path, status: "idle" })),
      jobProgress: {},
      exportSignatures: {},
      showToast: vi.fn(),
    };
    const set = (patch) => {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    };
    const renderer = createProcessingRun(set, () => state);
    const subscriptions = new Map();
    const api = Object.fromEntries(
      Object.entries(IPC_EVENTS).map(([name, channel]) => [
        name,
        (handler) => {
          subscriptions.set(channel, handler);
          return () => subscriptions.delete(channel);
        },
      ]),
    );
    const disconnect = renderer.connect(api);
    mocks.sendToRenderer.mockImplementation((channel, payload) =>
      subscriptions.get(channel)?.(payload),
    );
    let pending;
    try {
      pending = mocks.handlers.get(IPC_INVOKE.startProcessing)(trustedSenderEvent, jobs);
      await vi.waitFor(() => expect(mocks.emitLine).toBeTypeOf("function"));
      fs.writeFileSync(mocks.jobs[0].output_path, "exported");
      const runError = messages.find(
        (msg) => msg.type === RUN_EVENTS.error.type && msg.index == null,
      );
      for (const msg of messages.filter((msg) => msg !== runError)) {
        mocks.emitLine(JSON.stringify(msg));
        if (msg.type === RUN_EVENTS.progress.type) expect(state.progressDone).toBe(msg.current);
        if (msg.type === RUN_EVENTS.jobProgress.type)
          await vi.waitFor(() => expect(state.jobProgress[0] ?? state.queue[0].progress).toBe(100));
      }
      mocks.resolveDone({ ok: false });
      const outcome = await pending;
      for (const event of contracts) {
        const subscription = event.jobSubscription || event.subscription;
        expect(subscriptions.has(IPC_EVENTS[subscription]), subscription).toBe(true);
        expect(calls(IPC_EVENTS[subscription]).length, subscription).toBeGreaterThan(0);
      }
      for (const [, payload] of mocks.sendToRenderer.mock.calls)
        expect(payload.runId).toBe(outcome.runId);
      expect(state.queue.map((job) => job.status)).toEqual(["done", "error", "idle"]);
      expect(state.batchSummary).toMatchObject({ total: 3, succeeded: 1, failed: 1, cancelled: 1 });
      expect(state.isProcessing).toBe(false);
      expect(calls(IPC_EVENTS.onError)).toHaveLength(0);
      expect(
        state.showToast.mock.calls
          .filter(([toast]) => toast.kind === "warn")
          .map(([toast]) => toast.text),
      ).toEqual(Object.values(RUN_WARNING_KEYS).map((key) => es[key]));

      mocks.done = new Promise((resolve) => {
        mocks.resolveDone = resolve;
      });
      mocks.emitLine = null;
      pending = mocks.handlers.get(IPC_INVOKE.startProcessing)(trustedSenderEvent, jobs);
      await vi.waitFor(() => expect(mocks.emitLine).toBeTypeOf("function"));
      mocks.emitLine(JSON.stringify(runError));
      expect(state.isProcessing).toBe(false);
      expect(state.showToast).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "err" }));
      mocks.resolveDone({ ok: false });
      expect(await pending).toMatchObject({ success: false });
      expect(calls(IPC_EVENTS.onError)).toHaveLength(1);
    } finally {
      mocks.resolveDone({ ok: false });
      await pending;
      disconnect();
    }
  });

  it("every event a run emits is run-scoped and carries that run's runId", async () => {
    const outputDir = tmpDir();
    const pending = mocks.handlers.get(IPC_INVOKE.startProcessing)(trustedSenderEvent, [
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
    const pending = mocks.handlers.get(IPC_INVOKE.startProcessing)(trustedSenderEvent, [
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
