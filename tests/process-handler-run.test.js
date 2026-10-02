import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  sendToRenderer: vi.fn(),
  killProcessTree: vi.fn(async () => {}),
  proc: null,
  done: null,
  resolveDone: null,
  emitLine: null,
  stderrTail: "",
  tempRoot: "",
  drain: null,
  jobs: [],
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
  app: { isPackaged: false, getPath: () => mocks.tempRoot },
}));

vi.mock("../main/shared-state.js", () => ({ getAppIsQuitting: () => false }));

vi.mock("../main/utils/paths.js", () => ({
  validateMediaBinaries: () => ({ ok: true }),
}));

vi.mock("../main/utils/processor-spawn.js", () => ({
  validateProcessorAvailableAsync: async () => ({ ok: true, command: "noop", args: [] }),
}));

vi.mock("../main/utils/job-worker.js", () => ({
  startJobRun: vi.fn(async ({ onLine, jobsFile }) => {
    mocks.jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8")).jobs;
    mocks.emitLine = onLine;
    return { proc: mocks.proc, done: mocks.done, stderrTail: () => mocks.stderrTail };
  }),
}));

vi.mock("../main/utils/media-task-pool.js", () => ({
  setMediaProcessingActive: vi.fn(),
  waitForMediaTasksToDrain: () => mocks.drain || Promise.resolve(),
}));

vi.mock("../main/utils/concurrency.js", () => ({
  runWithConcurrency: async (jobs) => jobs,
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
  sanitizeJobMedia: (job, _security, { outputDirectory }) => ({
    ...job,
    output_path: job.output_path || path.join(outputDirectory, "out.mp4"),
  }),
}));
vi.mock("../main/utils/kill-process-tree.js", () => ({
  killProcessTree: (...args) => mocks.killProcessTree(...args),
}));

const { registerProcessHandlers } = await import("../main/handlers/process.js");
const { startJobRun } = await import("../main/utils/job-worker.js");
const runModule = await import("../main/processing-run.js");

let tmpDirs = [];
let outputDir;
let artifactsDir = null;

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-handler-test-"));
  tmpDirs.push(dir);
  return dir;
}

function fakeProc(pid = 9100) {
  const proc = new EventEmitter();
  proc.pid = pid;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
  proc.stdin = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => {
    proc.killed = true;
    return true;
  });
  return proc;
}

const calls = (channel) => mocks.sendToRenderer.mock.calls.filter(([c]) => c === channel);

beforeEach(() => {
  outputDir = tmpDir();
  mocks.tempRoot = tmpDir();
  mocks.proc = fakeProc();
  mocks.done = new Promise((resolve) => {
    mocks.resolveDone = resolve;
  });
  mocks.emitLine = null;
  mocks.stderrTail = "";
  mocks.drain = null;
  mocks.sendToRenderer.mockClear();
  mocks.killProcessTree.mockClear();
  registerProcessHandlers({ getOutputDirectory: () => outputDir });
});

afterEach(async () => {
  vi.useRealTimers();
  const cancellation = runModule.cancelRun();
  mocks.proc.exitCode = 1;
  mocks.proc.emit("close", 1);
  await cancellation;
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tmpDirs = [];
  artifactsDir = null;
});

function artifactsDirOf() {
  return (
    fs
      .readdirSync(mocks.tempRoot)
      .map((name) => path.join(mocks.tempRoot, name))
      .find((p) => path.basename(p).startsWith("beru-jobs-")) || null
  );
}

describe("process:start with a fake job worker", () => {
  it("rejects an output that would overwrite another queued input", async () => {
    const input = path.join(outputDir, "a.mp4");
    const otherInput = path.join(outputDir, "a_beru.mp4");
    fs.writeFileSync(input, "first source");
    fs.writeFileSync(otherInput, "second source");
    mocks.resolveDone({ ok: true });

    const result = await mocks.handlers.get("process:start")({}, [
      { id: 0, input_path: input, output_path: otherInput },
      { id: 1, input_path: otherInput, output_path: path.join(outputDir, "second.mp4") },
    ]);

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/entrada/i) });
    expect(fs.readFileSync(otherInput, "utf8")).toBe("second source");
    expect(calls("process:runStarted")).toHaveLength(0);
  });

  it("rejects duplicate output paths before starting a worker", async () => {
    mocks.resolveDone({ ok: true });
    const result = await mocks.handlers.get("process:start")({}, [
      { id: 0, input_path: "a.mp4", output_path: path.join(outputDir, "same.mp4") },
      { id: 1, input_path: "b.mp4", output_path: path.join(outputDir, "SAME.mp4") },
    ]);
    expect(result.success).toBe(false);
    expect(calls("process:runStarted")).toHaveLength(0);
  });

  it("runs to completion: snapshots outputs, forwards lines, settles clean", async () => {
    const input = path.join(outputDir, "in.mp4");
    fs.writeFileSync(input, "in");
    const output = path.join(outputDir, "done.mp4");

    const pending = mocks.handlers.get("process:start")({}, [
      { id: 7, input_path: input, output_path: output },
    ]);

    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    artifactsDir = artifactsDirOf();
    fs.writeFileSync(mocks.jobs[0].output_path, "exported");
    mocks.emitLine('{"type":"complete","index":7}');
    mocks.resolveDone({ ok: true });
    const result = await pending;

    expect(result).toMatchObject({ success: true, code: 0 });
    const runId = calls("process:runStarted")[0][1].runId;
    expect(runId).toBeTruthy();
    expect(calls("process:complete")[0][1]).toMatchObject({ index: 7, runId });
    expect(calls("process:complete")[0][1].output).toBe(output);
    expect(fs.readFileSync(output, "utf8")).toBe("exported");
    expect(calls("process:finished")).toHaveLength(1);
    expect(calls("process:finished")[0][1]).toMatchObject({ code: 0, runId });
    expect(runModule.hasActiveProcessing()).toBe(false);
    expect(fs.existsSync(artifactsDir)).toBe(false);
  });

  it("a settled run cannot emit process:finished twice (error then close)", async () => {
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);

    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    mocks.proc.emit("error", new Error("spawn failed"));
    const result = await pending;

    expect(result).toMatchObject({ success: false });
    expect(calls("process:error")).toHaveLength(1);
    mocks.proc.emit("close", 1);
    mocks.resolveDone({ ok: true });
    await Promise.resolve();
    expect(calls("process:finished")).toHaveLength(0);
    expect(mocks.proc.listenerCount("close")).toBe(0);
    expect(runModule.hasActiveProcessing()).toBe(false);
  });

  it("cancel mid-run emits process:finished exactly once", async () => {
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);

    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    artifactsDir = artifactsDirOf();

    const cancelResult = mocks.handlers.get("process:cancel")({});
    expect(fs.readFileSync(path.join(artifactsDir, "manifest.cancel"), "utf8")).toBe("1");
    mocks.proc.emit("close", 0);
    const [cancel, start] = await Promise.all([cancelResult, pending]);

    expect(cancel).toEqual({ success: true, idle: false });
    expect(start).toMatchObject({ cancelled: true });
    const finished = calls("process:finished");
    expect(finished).toHaveLength(1);
    expect(finished[0][1]).toMatchObject({ cancelled: true });
    expect(mocks.killProcessTree).toHaveBeenCalledWith(mocks.proc);
    expect(runModule.hasActiveProcessing()).toBe(false);
    expect(fs.existsSync(artifactsDir)).toBe(false);
  });

  it.each(["cancel", "failure"])(
    "%s preserves previous exports and promotes only completed staged outputs",
    async (ending) => {
      const input = path.join(outputDir, "in.mp4");
      fs.writeFileSync(input, "in");
      const done = path.join(outputDir, "done.mp4");
      const partial = path.join(outputDir, "partial.mp4");
      fs.writeFileSync(done, "previous done");
      fs.writeFileSync(partial, "previous partial");

      const pending = mocks.handlers.get("process:start")({}, [
        { id: 3, input_path: input, output_path: done },
        { id: 4, input_path: input, output_path: partial },
      ]);

      await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
      fs.writeFileSync(mocks.jobs[0].output_path, "new done");
      fs.writeFileSync(mocks.jobs[1].output_path, "new partial");
      mocks.emitLine('{"type":"complete","index":3}');

      if (ending === "cancel") {
        const cancelResult = mocks.handlers.get("process:cancel")({});
        mocks.proc.emit("close", 0);
        await Promise.all([cancelResult, pending]);
      } else {
        mocks.resolveDone({ ok: false, error: "encode failed" });
        expect(await pending).toMatchObject({ success: false });
      }

      expect(fs.readFileSync(done, "utf8")).toBe("new done");
      expect(fs.readFileSync(partial, "utf8")).toBe("previous partial");
      expect(fs.existsSync(input)).toBe(true);
      expect(fs.readdirSync(outputDir).sort()).toEqual(["done.mp4", "in.mp4", "partial.mp4"]);
    },
  );

  it("a failed export leaves the previous file intact and removes its temporary output", async () => {
    const input = path.join(outputDir, "in.mp4");
    const output = path.join(outputDir, "out.mp4");
    fs.writeFileSync(input, "input");
    fs.writeFileSync(output, "previous export");
    const pending = mocks.handlers.get("process:start")({}, [
      { id: 0, input_path: input, output_path: output },
    ]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    fs.writeFileSync(mocks.jobs[0].output_path, "truncated");
    mocks.resolveDone({ ok: false, error: "encode failed" });
    expect(await pending).toMatchObject({ success: false });
    expect(fs.readFileSync(output, "utf8")).toBe("previous export");
    expect(fs.readdirSync(outputDir).sort()).toEqual(["in.mp4", "out.mp4"]);
  });

  it("does not attach a late worker after cancelling its startup", async () => {
    let releaseStartup;
    let enteredStartup;
    let signal;
    const entered = new Promise((resolve) => {
      enteredStartup = resolve;
    });
    const ready = new Promise((resolve) => {
      releaseStartup = resolve;
    });
    startJobRun.mockImplementationOnce(async (options) => {
      signal = options.signal;
      enteredStartup();
      await ready;
      return { proc: mocks.proc, done: mocks.done, stderrTail: () => "" };
    });
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    await entered;
    await mocks.handlers.get("process:cancel")({});
    expect(signal.aborted).toBe(true);
    releaseStartup();
    expect(await pending).toMatchObject({ cancelled: true });
    expect(runModule.getPythonProcess()).toBeNull();
    expect(mocks.proc.listenerCount("close")).toBe(0);
    expect(fs.readdirSync(outputDir)).toEqual([]);
    expect(calls("process:finished")).toHaveLength(1);
  });

  it("reports a promotion failure without deleting the destination", async () => {
    const output = path.join(outputDir, "existing-directory.mp4");
    fs.mkdirSync(output);
    const pending = mocks.handlers.get("process:start")({}, [
      { id: 0, input_path: "clip.mp4", output_path: output },
    ]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    fs.writeFileSync(mocks.jobs[0].output_path, "exported");
    mocks.emitLine('{"type":"complete","index":0}');
    mocks.resolveDone({ ok: true });
    expect(await pending).toMatchObject({ success: false });
    expect(calls("process:complete")).toHaveLength(0);
    expect(calls("process:jobError")).toHaveLength(1);
    expect(fs.statSync(output).isDirectory()).toBe(true);
    expect(fs.readdirSync(outputDir)).toEqual(["existing-directory.mp4"]);
  });

  it("refuses a second run while one is active", async () => {
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "a.mp4" }]);
    await vi.waitFor(() => expect(runModule.hasActiveProcessing()).toBe(true));

    const second = await mocks.handlers.get("process:start")({}, [{ input_path: "b.mp4" }]);
    expect(second).toMatchObject({ success: false, error: "Ya hay un proceso en ejecución" });

    mocks.resolveDone({ ok: true });
    await pending;
  });

  it("settles a dead worker response even when no child event follows", async () => {
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    let result;
    pending.then((value) => {
      result = value;
    });
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    mocks.proc.exitCode = 1;
    mocks.resolveDone({ died: true, error: "worker stdin failed" });
    try {
      await vi.waitFor(
        () => expect(result).toMatchObject({ success: false, error: "worker stdin failed" }),
        { timeout: 200 },
      );
      expect(runModule.hasActiveProcessing()).toBe(false);
      expect(calls("process:finished")).toHaveLength(1);
    } finally {
      mocks.proc.emit("close", 1);
      await pending;
    }
  });

  it("coalesces concurrent cancellation and ignores a late worker result", async () => {
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    const first = mocks.handlers.get("process:cancel")({});
    const second = mocks.handlers.get("process:cancel")({});
    mocks.proc.emit("close", 0);
    await Promise.all([first, second, pending]);
    mocks.resolveDone({ ok: true });
    await Promise.resolve();
    expect(mocks.killProcessTree).toHaveBeenCalledTimes(1);
    expect(calls("process:finished")).toHaveLength(1);
  });

  it("keeps the lock until cancellation finishes terminating the worker tree", async () => {
    let releaseKill;
    const killed = new Promise((resolve) => {
      releaseKill = resolve;
    });
    mocks.killProcessTree.mockImplementationOnce(() => killed);
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    const cancellation = mocks.handlers.get("process:cancel")({});
    mocks.proc.emit("close", 0);
    await vi.waitFor(() => expect(mocks.killProcessTree).toHaveBeenCalled());
    try {
      expect(runModule.hasActiveProcessing()).toBe(true);
      const second = await mocks.handlers.get("process:start")({}, [{ input_path: "other.mp4" }]);
      expect(second).toMatchObject({ code: "already_processing" });
    } finally {
      releaseKill();
      await Promise.all([cancellation, pending]);
    }
    expect(runModule.hasActiveProcessing()).toBe(false);
    expect(calls("process:finished")).toHaveLength(1);
  });

  it("the watchdog resolves the invocation as well as releasing a dead worker lock", async () => {
    vi.useFakeTimers();
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    let result;
    pending.then((value) => {
      result = value;
    });
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    mocks.proc.exitCode = 1;
    try {
      await vi.advanceTimersByTimeAsync(runModule.PROCESSING_LOCK_MAX_MS + 1);
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/interrumpió/) });
      expect(runModule.hasActiveProcessing()).toBe(false);
      expect(calls("process:error")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      mocks.proc.emit("close", 1);
      await pending;
    }
  });

  it.each(["preparing", "running"])("the watchdog retains an active %s run", async (phase) => {
    vi.useFakeTimers();
    let releaseDrain;
    if (phase === "preparing")
      mocks.drain = new Promise((resolve) => {
        releaseDrain = resolve;
      });
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    await vi.waitFor(() =>
      expect(phase === "running" ? runModule.getPythonProcess() : artifactsDirOf()).toBeTruthy(),
    );
    await vi.advanceTimersByTimeAsync(runModule.PROCESSING_LOCK_MAX_MS + 1);
    expect(runModule.hasActiveProcessing()).toBe(true);
    expect(calls("process:error")).toHaveLength(0);
    if (phase === "running") {
      mocks.resolveDone({ ok: true });
      await pending;
    } else {
      await mocks.handlers.get("process:cancel")({});
      releaseDrain();
      await pending;
    }
    await vi.advanceTimersByTimeAsync(runModule.PROCESSING_LOCK_MAX_MS + 1);
    expect(calls("process:error")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("allows cooperative cancellation for 1500ms before terminating the tree", async () => {
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    vi.useFakeTimers();
    mocks.killProcessTree.mockImplementationOnce(async (proc) => {
      proc.emit("close", 0);
    });
    const cancellation = mocks.handlers.get("process:cancel")({});
    await vi.advanceTimersByTimeAsync(1499);
    expect(mocks.killProcessTree).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.killProcessTree).toHaveBeenCalledTimes(1);
    await Promise.all([cancellation, pending]);
    vi.useRealTimers();
  });

  it("ignores old callbacks without touching the next run or its files", async () => {
    const first = mocks.handlers.get("process:start")({}, [{ input_path: "first.mp4" }]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    const oldLine = mocks.emitLine;
    const oldDone = mocks.resolveDone;
    const oldRunId = calls("process:runStarted")[0][1].runId;
    const cancellation = mocks.handlers.get("process:cancel")({});
    mocks.proc.emit("close", 0);
    await Promise.all([cancellation, first]);

    mocks.proc = fakeProc(9101);
    mocks.done = new Promise((resolve) => {
      mocks.resolveDone = resolve;
    });
    const second = mocks.handlers.get("process:start")({}, [{ input_path: "second.mp4" }]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    const nextRunId = calls("process:runStarted")[1][1].runId;
    expect(nextRunId).not.toBe(oldRunId);
    const nextManifestDir = artifactsDirOf();
    fs.writeFileSync(mocks.jobs[0].output_path, "next export");
    oldLine('{"type":"complete","index":0}');
    oldDone({ ok: true });
    await Promise.resolve();
    expect(calls("process:finished")).toHaveLength(1);
    expect(calls("process:complete")).toHaveLength(0);
    expect(runModule.hasActiveProcessing()).toBe(true);
    expect(fs.existsSync(nextManifestDir)).toBe(true);
    mocks.emitLine('{"type":"complete","index":0}');
    mocks.resolveDone({ ok: true });
    expect(await second).toMatchObject({ success: true, runId: nextRunId });
    expect(calls("process:complete")[0][1].runId).toBe(nextRunId);
    expect(runModule.getPythonProcess()).toBeNull();
    expect(fs.readFileSync(path.join(outputDir, "out.mp4"), "utf8")).toBe("next export");
  });

  it("cancellation shares the teardown already requested by a failed worker", async () => {
    let releaseKill;
    const killed = new Promise((resolve) => {
      releaseKill = resolve;
    });
    mocks.killProcessTree.mockImplementationOnce(async (proc) => {
      await killed;
      proc.exitCode = 1;
      proc.emit("close", 1);
    });
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    mocks.resolveDone({ died: true, error: "worker stopped" });
    await vi.waitFor(() => expect(mocks.killProcessTree).toHaveBeenCalled());
    const cancellation = mocks.handlers.get("process:cancel")({});
    expect(runModule.hasActiveProcessing()).toBe(true);
    releaseKill();
    await cancellation;
    expect(await pending).toMatchObject({ success: false, cancelled: true });
    expect(mocks.killProcessTree).toHaveBeenCalledTimes(1);
    expect(calls("process:finished")).toHaveLength(1);
    expect(runModule.hasActiveProcessing()).toBe(false);
  });

  it("falls back to child termination when tree termination rejects after a worker failure", async () => {
    mocks.killProcessTree.mockRejectedValueOnce(new Error("tree termination failed"));
    mocks.proc.kill.mockImplementation(() => {
      mocks.proc.exitCode = 1;
      mocks.proc.emit("close", 1);
      return true;
    });
    const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
    let result;
    pending.then((value) => {
      result = value;
    });
    await vi.waitFor(() => expect(runModule.getPythonProcess()).toBe(mocks.proc));
    mocks.resolveDone({ died: true, error: "worker stopped" });
    try {
      await vi.waitFor(
        () => expect(result).toMatchObject({ success: false, error: "worker stopped" }),
        { timeout: 200 },
      );
      expect(mocks.proc.kill).toHaveBeenCalledTimes(1);
      expect(calls("process:finished")).toHaveLength(1);
      expect(runModule.hasActiveProcessing()).toBe(false);
    } finally {
      const cancellation = runModule.cancelRun();
      mocks.proc.emit("close", 1);
      await cancellation;
      await pending;
    }
  });

  it("disposes manifest artifacts that arrive after cancellation", async () => {
    let releaseArtifacts;
    let enteredArtifacts;
    let manifestDir;
    const entered = new Promise((resolve) => {
      enteredArtifacts = resolve;
    });
    const ready = new Promise((resolve) => {
      releaseArtifacts = resolve;
    });
    const workerStarts = startJobRun.mock.calls.length;
    const createDir = vi.spyOn(fs.promises, "mkdtemp").mockImplementationOnce(async (prefix) => {
      manifestDir = fs.mkdtempSync(prefix);
      enteredArtifacts();
      await ready;
      return manifestDir;
    });
    try {
      const pending = mocks.handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);
      await entered;
      await mocks.handlers.get("process:cancel")({});
      expect(await pending).toMatchObject({ cancelled: true });
      releaseArtifacts();
      await vi.waitFor(() => expect(fs.existsSync(manifestDir)).toBe(false));
      expect(runModule.hasActiveProcessing()).toBe(false);
      expect(startJobRun.mock.calls).toHaveLength(workerStarts);
      expect(calls("process:finished")).toHaveLength(1);
      expect(fs.readdirSync(outputDir)).toEqual([]);
    } finally {
      releaseArtifacts();
      createDir.mockRestore();
    }
  });
});
