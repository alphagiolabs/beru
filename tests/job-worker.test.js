import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
const invalidateSystemPythonCache = vi.hoisted(() => vi.fn());
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, spawn }, spawn };
});
vi.mock("../main/utils/processor-spawn.js", () => ({
  buildProcessorChildEnv: () => ({}),
  invalidateSystemPythonCache,
}));
vi.mock("../main/utils/paths.js", () => ({
  validateMediaBinaries: () => ({ ok: false }),
}));
vi.mock("../main/utils/kill-process-tree.js", () => ({
  killProcessTree: async (proc) => proc.kill(),
}));

import { disposeJobWorker, startJobRun } from "../main/utils/job-worker.js";

const SPAWN_SPEC = { command: "processor", args: [] };

function fakeWorker() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  vi.spyOn(proc.stdin, "write");
  proc.kill = vi.fn(() => true);
  proc.killed = false;
  proc.exitCode = null;
  return proc;
}

async function readyWorker(proc = fakeWorker(), onLine) {
  spawn.mockReturnValueOnce(proc);
  const runPromise = startJobRun({ spawnSpec: SPAWN_SPEC, jobsFile: "m.json", env: {}, onLine });
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  proc.stdout.write('{"type":"ready","ok":true}\n');
  const run = await runPromise;
  await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalled());
  return { proc, run };
}

function requestLine(proc, call = 0) {
  return JSON.parse(proc.stdin.write.mock.calls[call][0]);
}

afterEach(() => {
  disposeJobWorker();
  spawn.mockReset();
  invalidateSystemPythonCache.mockReset();
});

describe("job worker protocol", () => {
  it("does not submit a cancelled request when the worker becomes ready later", async () => {
    const proc = fakeWorker();
    spawn.mockReturnValueOnce(proc);
    const controller = new AbortController();
    const pending = startJobRun({
      spawnSpec: SPAWN_SPEC,
      jobsFile: "cancelled.json",
      signal: controller.signal,
    });
    controller.abort();
    proc.stdout.write('{"type":"ready","ok":true}\n');
    await expect(pending).resolves.toBeNull();
    expect(proc.stdin.write).not.toHaveBeenCalled();

    const next = await startJobRun({ spawnSpec: SPAWN_SPEC, jobsFile: "next.json" });
    expect(requestLine(proc).jobs_file).toBe("next.json");
    proc.stdout.write('{"type":"run_end","ok":true}\n');
    expect(await next.done).toMatchObject({ ok: true });
  });

  it("allows only one request to claim a starting worker", async () => {
    const proc = fakeWorker();
    spawn.mockReturnValueOnce(proc);
    const first = startJobRun({ spawnSpec: SPAWN_SPEC, jobsFile: "first.json" });
    const second = startJobRun({ spawnSpec: SPAWN_SPEC, jobsFile: "second.json" });
    const rejected = expect(second).rejects.toThrow(/ocupado/);
    proc.stdout.write('{"type":"ready","ok":true}\n');
    await first;
    await rejected;
    expect(proc.stdin.write).toHaveBeenCalledTimes(1);
  });

  it("spawns the processor with --job-worker and sends the request envelope", async () => {
    const { proc } = await readyWorker();
    expect(spawn).toHaveBeenCalledWith(
      "processor",
      ["--job-worker"],
      expect.objectContaining({ windowsHide: true }),
    );
    const req = requestLine(proc);
    expect(req.jobs_file).toBe("m.json");
    expect(Number.isInteger(req.id)).toBe(true);
  });

  it("forwards event lines to onLine and resolves done on run_end", async () => {
    const lines = [];
    const proc = fakeWorker();
    spawn.mockReturnValueOnce(proc);
    const runPromise = startJobRun({
      spawnSpec: SPAWN_SPEC,
      jobsFile: "m.json",
      env: {},
      onLine: (line) => lines.push(JSON.parse(line)),
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.stdout.write('{"type":"ready","ok":true}\n');
    const run = await runPromise;

    const id = requestLine(proc).id;
    proc.stdout.write('{"type":"progress","current":1,"total":1}\n');
    proc.stdout.write('{"type":"summary","total":1,"succeeded":1}\n');
    proc.stdout.write(`${JSON.stringify({ type: "run_end", id, ok: true })}\n`);

    expect(await run.done).toMatchObject({ ok: true });
    expect(lines).toEqual([
      { type: "progress", current: 1, total: 1 },
      { type: "summary", total: 1, succeeded: 1 },
    ]);
    expect(lines.some((line) => line.type === "run_end" || line.type === "ready")).toBe(false);
  });

  it("isolates callback errors for streamed lines and exit remainders", async () => {
    const onLine = vi.fn(() => {
      throw new Error("Log consumer failed");
    });
    const { proc, run } = await readyWorker(undefined, onLine);
    const progress = '{"type":"progress","current":1,"total":1}';
    const summary = '{"type":"summary","total":1,"succeeded":1}';

    expect(() => proc.stdout.write(`${progress}\n`)).not.toThrow();
    proc.stdout.write(summary);
    expect(() => proc.emit("close", 0)).not.toThrow();

    expect(onLine.mock.calls).toEqual([[progress], [summary]]);
    expect(await run.done).toMatchObject({ died: true, code: 0 });
  });

  it("reuses one process across sequential runs", async () => {
    const first = await readyWorker();
    const id1 = requestLine(first.proc).id;
    first.proc.stdout.write(`${JSON.stringify({ type: "run_end", id: id1, ok: true })}\n`);
    await first.run.done;

    const secondRun = await startJobRun({
      spawnSpec: SPAWN_SPEC,
      jobsFile: "m2.json",
      env: {},
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(first.proc.stdin.write).toHaveBeenCalledTimes(2));
    const id2 = requestLine(first.proc, 1).id;
    expect(id2).not.toBe(id1);
    first.proc.stdout.write(`${JSON.stringify({ type: "run_end", id: id2, ok: true })}\n`);
    expect(await secondRun.done).toMatchObject({ ok: true });
  });

  it("invalidates the resolved python cache when the worker fails to spawn", async () => {
    const proc = fakeWorker();
    spawn.mockReturnValueOnce(proc);
    const pending = startJobRun({ spawnSpec: SPAWN_SPEC, jobsFile: "m.json" });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.emit("error", new Error("spawn ENOENT"));
    await expect(pending).rejects.toThrow("spawn ENOENT");
    expect(invalidateSystemPythonCache).toHaveBeenCalled();
  });

  it("resolves done with died when the worker exits mid-run", async () => {
    const { proc, run } = await readyWorker();
    proc.stdout.write('{"type":"progress","current":0}\n');
    proc.emit("close", 1);
    expect(await run.done).toMatchObject({ died: true, code: 1 });

    const replacement = await readyWorker();
    expect(replacement.proc).not.toBe(proc);
  });

  it("surfaces run_end failures with the worker error", async () => {
    const { proc, run } = await readyWorker();
    const id = requestLine(proc).id;
    proc.stdout.write(
      `${JSON.stringify({ type: "run_end", id, ok: false, error: "Invalid jobs manifest" })}\n`,
    );
    expect(await run.done).toMatchObject({ ok: false, error: "Invalid jobs manifest" });
  });

  it("closes a malformed-request run_end with a null id", async () => {
    const { proc, run } = await readyWorker();
    proc.stdout.write('{"type":"run_end","id":null,"ok":false,"error":"Invalid job request"}\n');
    expect(await run.done).toMatchObject({ ok: false });
  });

  it("dispose kills the worker and settles the active run", async () => {
    const { proc, run } = await readyWorker();
    disposeJobWorker();
    expect(proc.kill).toHaveBeenCalled();
    expect(await run.done).toMatchObject({ died: true });
  });
});
