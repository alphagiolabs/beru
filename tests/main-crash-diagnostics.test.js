import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { requireWindows } from "../shared/platform.js";

const source = fs
  .readFileSync(path.join(process.cwd(), "main", "main.js"), "utf8")
  .replace(/^import\b[\s\S]*?;\r?\n/gm, "");

function startMain({
  existingLog = "",
  onWrite,
  appPath = "/beru-repo",
  pythonProcess = null,
  killProcessTree = vi.fn(),
} = {}) {
  const appEvents = new Map();
  const processEvents = new Map();
  const quit = vi.fn();
  let log = existingLog;
  const append = vi.fn((_file, entry) => {
    onWrite?.(processEvents);
    log += entry;
  });
  const app = {
    getPath: (key) => (key === "userData" ? "/beru-data" : "/tmp"),
    getAppPath: () => appPath,
    on: (name, handler) => appEvents.set(name, handler),
    whenReady: () => new Promise(() => {}),
    commandLine: { appendSwitch: vi.fn() },
    setName: vi.fn(),
    setAppUserModelId: vi.fn(),
    quit,
  };
  const context = {
    requireWindows,
    app,
    BrowserWindow: {},
    protocol: { registerSchemesAsPrivileged: vi.fn() },
    fs: {
      readdirSync: () => [],
      statSync: () => ({ size: Buffer.byteLength(log) }),
      writeFileSync: (_file, entry) => {
        log = entry;
      },
      appendFileSync: append,
    },
    path,
    fileURLToPath,
    console: {
      error: () => {
        throw new Error("EPIPE");
      },
    },
    process: { platform: "win32", on: (name, handler) => processEvents.set(name, handler) },
    Buffer,
    Date,
    createPathSecurity: () => ({}),
    setAppIsQuitting: vi.fn(),
    getPythonProcess: () => pythonProcess,
    hasActiveProcessing: () => false,
    cancelRun: vi.fn(async () => ({ success: true, idle: true })),
    sweepOrphanedArtifacts: vi.fn(),
    disposeJobWorker: vi.fn(),
    createBeruVideoResponse: vi.fn(),
    hasKnownBeruType: vi.fn(() => true),
    validateBeruRequestPath: vi.fn(),
    killProcessTree,
    createWindow: vi.fn(),
    disposePreviewFrameWorker: vi.fn(),
    disposePetsModule: vi.fn(),
    isQuittingForUpdate: () => false,
  };
  for (const name of [
    "registerDialogHandlers",
    "registerVideoHandlers",
    "registerDropHandlers",
    "registerFileHandlers",
    "registerProcessHandlers",
    "registerProjectHandlers",
    "registerPresetHandlers",
    "registerSettingsHandlers",
    "registerRecentHandlers",
    "registerSystemHandlers",
    "registerUpdaterHandlers",
    "registerPetsModule",
  ])
    context[name] = vi.fn();
  vm.runInNewContext(source, context, { filename: "main/main.js" });
  return { appEvents, processEvents, quit, append, getLog: () => log };
}

describe("main process crash diagnostics", () => {
  it("persists a fatal event without logging secrets or recursing on a broken console", () => {
    const main = startMain({
      onWrite: (events) => events.get("uncaughtException")(new Error("nested secret")),
    });
    const error = new Error("token=private-value");
    error.code = "EPIPE";
    main.processEvents.get("uncaughtException")(error);
    expect(main.getLog()).toMatch(/fatal.*uncaughtException.*EPIPE/);
    expect(main.getLog()).not.toMatch(/private-value|nested secret/);
    expect(main.append).toHaveBeenCalledTimes(1);
    expect(main.quit).toHaveBeenCalledTimes(1);
  });

  it("keeps only repo main frames while redacting sensitive messages and absolute paths", () => {
    const appPath = path.join("/home", "user-secret", "beru");
    const main = startMain({ appPath });
    const error = new Error("token=private-value");
    error.code = "token=private-value";
    error.stack = [
      "Error: token=private-value",
      `    at outsider (${path.join("/other", "main", "secret.js")}:1:2)`,
      `    at processJob (${path.join(appPath, "main", "handlers", "process.js")}:21:3)`,
      `    at run (${path.join(appPath, "main", "main.js")}:60:4)`,
      `    at later (${path.join(appPath, "main", "ignored.js")}:99:1)`,
    ].join("\n");

    main.processEvents.get("unhandledRejection")(error);
    expect(main.getLog()).toContain("fatal unhandledRejection unknown");
    expect(main.getLog()).toContain("main/handlers/process.js:21:3");
    expect(main.getLog()).toContain("main/main.js:60:4");
    expect(main.getLog()).not.toMatch(/private-value|user-secret|secret\.js|ignored\.js/);
    expect(Buffer.byteLength(main.getLog())).toBeLessThanOrEqual(65536);
  });

  it("consumes an asynchronous process-tree kill rejection during fatal cleanup", async () => {
    let rejectedKillObserved = false;
    const killProcessTree = vi.fn(() => ({
      then: (_resolve, reject) => {
        rejectedKillObserved = true;
        reject(new Error("cleanup failure"));
      },
    }));
    const main = startMain({ pythonProcess: { pid: 123 }, killProcessTree });
    main.processEvents.get("uncaughtException")(new Error("fatal"));
    await Promise.resolve();
    await Promise.resolve();
    expect(killProcessTree).toHaveBeenCalledTimes(1);
    expect(rejectedKillObserved).toBe(true);
    expect(main.quit).toHaveBeenCalledTimes(1);
    expect(main.append).toHaveBeenCalledTimes(1);
  });

  it("records renderer exit reason and code, distinguishing a requested quit", () => {
    const main = startMain();
    main.appEvents.get("render-process-gone")(null, null, {
      reason: "crashed",
      exitCode: 9,
      details: "password=private-value",
    });
    main.appEvents.get("before-quit")({ preventDefault: vi.fn() });
    main.appEvents.get("render-process-gone")(null, null, {
      reason: "clean-exit",
      exitCode: 0,
    });
    expect(main.getLog()).toMatch(/renderer-gone.*unexpected.*crashed.*9/);
    expect(main.getLog()).toMatch(/renderer-gone.*requested.*clean-exit.*0/);
    expect(main.getLog()).not.toContain("private-value");
    expect(main.quit).not.toHaveBeenCalled();
  });

  it("bounds the local log and never serializes unknown renderer input", () => {
    const main = startMain({ existingLog: "x".repeat(65536) });
    main.appEvents.get("render-process-gone")(null, null, {
      reason: "api-key=private-value",
      exitCode: "private-value",
    });
    expect(main.getLog()).toContain("renderer-gone");
    expect(main.getLog()).not.toContain("private-value");
    expect(Buffer.byteLength(main.getLog())).toBeLessThanOrEqual(65536);
  });
});
