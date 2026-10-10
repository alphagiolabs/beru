import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

const spawn = vi.hoisted(() => vi.fn());
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, spawn }, spawn };
});

const ORIGINAL_ENV = {
  BERU_PYTHON: process.env.BERU_PYTHON,
  BERU_USE_BUNDLED: process.env.BERU_USE_BUNDLED,
};
let tmpDirs = [];

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function tempPython() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-py-cache-"));
  tmpDirs.push(dir);
  const exe = path.join(dir, "python.exe");
  fs.writeFileSync(exe, "");
  return exe;
}

function failingProc() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.kill = vi.fn(() => true);
  setImmediate(() => proc.emit("error", new Error("spawn ENOENT")));
  return proc;
}

async function freshModule() {
  delete process.env.BERU_USE_BUNDLED;
  vi.resetModules();
  return import("../main/utils/processor-spawn.js");
}

afterEach(() => {
  restoreEnv();
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tmpDirs = [];
  spawn.mockReset();
});

describe("system python resolution cache", () => {
  it("re-resolves when the cached python path no longer exists", async () => {
    const mod = await freshModule();
    spawn.mockImplementation(failingProc);
    const gone = tempPython();
    process.env.BERU_PYTHON = gone;

    const first = await mod.resolveProcessorSpawnAsync([]);
    expect(first?.command).toBe(gone);

    fs.rmSync(gone);
    const second = await mod.resolveProcessorSpawnAsync([]);
    expect(second?.command ?? null).not.toBe(gone);
  });

  it("re-resolves when BERU_PYTHON points at a different executable", async () => {
    const mod = await freshModule();
    const first = tempPython();
    process.env.BERU_PYTHON = first;
    expect((await mod.resolveProcessorSpawnAsync([]))?.command).toBe(first);

    const second = tempPython();
    process.env.BERU_PYTHON = second;
    expect((await mod.resolveProcessorSpawnAsync([]))?.command).toBe(second);
  });

  it("re-probes after a failed resolution so a python installed later is picked up", async () => {
    const mod = await freshModule();
    spawn.mockImplementation(failingProc);
    delete process.env.BERU_PYTHON;

    const first = await mod.resolveProcessorSpawnAsync([]);
    expect(first?.mode ?? null).not.toBe("script");

    const installed = tempPython();
    process.env.BERU_PYTHON = installed;
    const second = await mod.resolveProcessorSpawnAsync([]);
    expect(second?.command).toBe(installed);
  });

  it("invalidateSystemPythonCache forces a fresh resolution", async () => {
    const mod = await freshModule();
    delete process.env.BERU_PYTHON;
    spawn.mockImplementation(() => {
      const proc = new EventEmitter();
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = vi.fn(() => true);
      setImmediate(() => proc.emit("close", 0));
      return proc;
    });
    const first = await mod.resolveProcessorSpawnAsync([]);
    expect(first?.mode).toBe("script");
    expect(await mod.resolveProcessorSpawnAsync([])).toEqual(first);
    expect(spawn).toHaveBeenCalledTimes(1);

    mod.invalidateSystemPythonCache();
    expect(await mod.resolveProcessorSpawnAsync([])).toEqual(first);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
