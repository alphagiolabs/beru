import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { runInNewContext } from "node:vm";

const mainSrc = fs.readFileSync(path.join(process.cwd(), "main", "main.js"), "utf-8");
const processSrc = fs.readFileSync(
  path.join(process.cwd(), "main", "handlers", "process.js"),
  "utf-8",
);
const sharedSrc = fs.readFileSync(path.join(process.cwd(), "main", "shared-state.js"), "utf-8");
const runSrc = fs.readFileSync(path.join(process.cwd(), "main", "processing-run.js"), "utf-8");

describe("quit during probe phase", () => {
  it("gates quit on hasActiveProcessing, not only getPythonProcess", () => {
    expect(mainSrc).toMatch(/hasActiveProcessing\(\)/);
    expect(mainSrc).toMatch(/setAppIsQuitting\(true\)/);
    expect(mainSrc).toMatch(/cancelActiveProcessing\(\)/);
    expect(mainSrc).not.toMatch(/if \(!getPythonProcess\(\)\) return;/);
  });

  it("exports appIsQuitting helpers from shared-state", () => {
    expect(sharedSrc).toMatch(/export const getAppIsQuitting/);
    expect(sharedSrc).toMatch(/export const setAppIsQuitting/);
    expect(runSrc).toMatch(/export const hasActiveProcessing/);
  });

  it("bails spawn when getAppIsQuitting after probe", () => {
    const probeIdx = processSrc.indexOf("enrichJobVideoInfo");
    const spawnIdx = processSrc.indexOf("spawn(spawnSpec.command");
    expect(probeIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(probeIdx);
    const between = processSrc.slice(probeIdx, spawnIdx);
    expect(between).toMatch(/getAppIsQuitting\(\)/);
    expect(between).toMatch(/cancelled\s*:\s*true/);
  });

  it.each([
    ["probe", "quit"],
    ["write", "quit"],
    ["probe", "superseded"],
    ["write", "superseded"],
  ])("cancels after %s on %s without clearing another run", async (stage, reason) => {
    let runId = null;
    let tmpFile = null;
    let originalTmpFile;
    let quitting = false;
    let probeActive = false;
    const handlers = new Map();
    const spawn = vi.fn();
    const unlinkSync = vi.fn();
    const interrupt = (phase) => {
      if (phase !== stage) return;
      originalTmpFile = tmpFile;
      if (reason === "quit") quitting = true;
      else {
        runId = "replacement";
        tmpFile = "replacement.json";
        probeActive = true;
      }
    };
    const writeFile = vi.fn(async () => interrupt("write"));
    const context = {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      app: { getPath: () => process.cwd() },
      path,
      os: { cpus: () => [0] },
      randomBytes: () => ({ toString: () => "test" }),
      fs: { unlinkSync, promises: { writeFile } },
      spawn,
      unwrapJobManifest: (jobs) => ({ jobs, manifest: null }),
      validateProcessorAvailableAsync: async () => ({ ok: true, args: [] }),
      validateMediaBinaries: () => ({ ok: true }),
      sanitizeJobMedia: (job) => job,
      findUnreadableInputsAsync: async () => [],
      getAppIsQuitting: () => quitting,
      beginProcessingRun: (id) => {
        runId = id;
        return true;
      },
      getProcessingRunId: () => runId,
      clearProcessingRun: () => {
        runId = null;
      },
      setCurrentTmpFile: (file) => {
        tmpFile = file;
      },
      getCurrentTmpFile: () => tmpFile,
      setProbePhaseActive: (active) => {
        probeActive = active;
      },
      setLastProcessingError: vi.fn(),
      sendToRenderer: vi.fn(),
      runWithConcurrency: async (jobs) => {
        interrupt("probe");
        return jobs;
      },
      createProcessorManifest: (_manifest, jobs) => ({ jobs }),
    };
    const executable = processSrc.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/\bexport /g, "");
    runInNewContext(executable, context);
    context.registerProcessHandlers({ getOutputDirectory: () => process.cwd() });
    const result = await handlers.get("process:start")({}, [{ input_path: "clip.mp4" }]);

    expect(result).toEqual({ success: false, error: "Procesamiento cancelado", cancelled: true });
    expect(spawn).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(stage === "write" ? 1 : 0);
    expect(unlinkSync).toHaveBeenCalledWith(originalTmpFile);
    expect(unlinkSync).toHaveBeenCalledWith(originalTmpFile.replace(".json", ".cancel"));
    expect(runId).toBe(reason === "quit" ? null : "replacement");
    expect(tmpFile).toBe(reason === "quit" ? null : "replacement.json");
    expect(probeActive).toBe(reason !== "quit");
    expect(unlinkSync).not.toHaveBeenCalledWith("replacement.json");
  });

  it("refuses to begin a processing run while app is quitting", () => {
    const beginIdx = processSrc.indexOf("beginProcessingRun(runId)");
    expect(beginIdx).toBeGreaterThan(-1);
    const beforeBegin = processSrc.slice(0, beginIdx);
    const guardIdx = beforeBegin.lastIndexOf("getAppIsQuitting()");
    expect(guardIdx).toBeGreaterThan(-1);
    const guardSlice = beforeBegin.slice(guardIdx, beginIdx);
    expect(guardSlice).toMatch(/cancelled\s*:\s*true/);
  });

  it("disposes temp files after cancel, not before", () => {
    expect(mainSrc).toMatch(
      /cancelActiveProcessing\(\)\.finally\(\(\)\s*=>\s*\{[\s\S]*disposeOnQuit\(\)/,
    );
  });
});
