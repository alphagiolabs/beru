import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";
import { vi } from "vitest";
import { IPC_EVENTS } from "../shared/ipc-channels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "..", "main", "updater.js");

function buildSource() {
  let src = fs.readFileSync(sourcePath, "utf-8");
  src = src.replace('import { app } from "electron";', "const app = globalThis.__mockElectronApp;");
  src = src.replace(
    'import { createRequire } from "module";',
    "const createRequire = globalThis.__mockCreateRequire;",
  );
  src = src.replace(
    /import\s*\{[^}]*getMainWindow[^}]*\}\s*from\s*["']\.\/shared-state\.js["'];?/,
    [
      "const getMainWindow = () => globalThis.__mockGetMainWindow && globalThis.__mockGetMainWindow();",
      "const isDev = !globalThis.__mockElectronApp.isPackaged;",
      "const setAppIsQuitting = (v) => { globalThis.__mockSetAppIsQuitting && globalThis.__mockSetAppIsQuitting(v); };",
    ].join("\n"),
  );
  src = src.replace(
    /import\s*\{\s*cancelRun\s*\}\s*from\s*["']\.\/processing-run\.js["'];?/,
    "const cancelRun = () => (globalThis.__mockCancelRun ? globalThis.__mockCancelRun() : Promise.resolve({ success: true, idle: true }));",
  );
  src = src.replace(
    /import\s*\{\s*IPC_EVENTS\s*\}\s*from\s*["']\.\.\/shared\/ipc-channels\.js["'];?/,
    "const IPC_EVENTS = globalThis.__mockIpcEvents;",
  );
  src = src.replace(/import\.meta\.url/g, '"file:///test/updater.js"');
  src = src.replace(
    /export\s*\{\s*([^}]+)\s*\};?/,
    (match, exports) => `module.exports = { ${exports} };`,
  );
  return src;
}

export function createUpdaterHarness() {
  const events = [];
  const handlers = new Map();
  let autoUpdater = null;
  let checkResolver = null;
  let downloadResolver = null;
  let downloadRejecter = null;

  const fakeApp = {
    isPackaged: true,
    getVersion: () => "1.6.36",
    getPath: () => "/tmp",
  };

  function createRequireMock() {
    return (id) => {
      if (id === "electron-updater") {
        if (!autoUpdater) {
          autoUpdater = {
            autoDownload: true,
            autoInstallOnAppQuit: true,
            logger: null,
            verifyUpdateCodeSignature: vi.fn(async () => "invalid signature"),
            on: (event, cb) => handlers.set(event, cb),
            checkForUpdates: async () =>
              new Promise((resolve) => {
                checkResolver = resolve;
              }),
            downloadUpdate: async () =>
              new Promise((resolve, reject) => {
                downloadResolver = resolve;
                downloadRejecter = reject;
              }),
            quitAndInstall: vi.fn(),
          };
        }
        return { autoUpdater };
      }
      throw new Error(`Unexpected require: ${id}`);
    };
  }

  globalThis.__mockElectronApp = fakeApp;
  globalThis.__mockCreateRequire = createRequireMock;

  const context = vm.createContext({
    console,
    setImmediate,
    setTimeout,
    clearTimeout,
    Promise,
    vi,
  });
  context.globalThis = context;
  context.__mockElectronApp = fakeApp;
  context.__mockCreateRequire = createRequireMock;
  context.__mockCancelRun = vi.fn(() => Promise.resolve({ success: true, idle: true }));
  context.__mockIpcEvents = IPC_EVENTS;
  context.__mockSetAppIsQuitting = vi.fn();

  const module = { exports: {} };
  context.module = module;
  context.exports = module.exports;

  const src = buildSource();
  vm.runInContext(src, context, { filename: sourcePath });

  const updater = context.module.exports;

  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => {
        if (channel === IPC_EVENTS.onUpdaterEvent) events.push(payload);
      },
    },
  };
  context.__mockGetMainWindow = () => fakeWindow;

  function emit(event, ...args) {
    const cb = handlers.get(event);
    if (cb) cb(...args);
  }

  function resolveCheck(value) {
    if (checkResolver) checkResolver(value);
    checkResolver = null;
  }

  function resolveDownload(value) {
    if (downloadResolver) downloadResolver(value);
    downloadResolver = null;
  }

  function rejectDownload(error) {
    if (downloadRejecter) downloadRejecter(error);
    downloadRejecter = null;
  }

  return {
    updater,
    fakeWindow,
    events,
    emit,
    resolveCheck,
    resolveDownload,
    rejectDownload,
    get autoUpdater() {
      return autoUpdater;
    },
    get cancelRun() {
      return context.__mockCancelRun;
    },
    get setAppIsQuitting() {
      return context.__mockSetAppIsQuitting;
    },
    init: () => updater.init(fakeWindow),
  };
}
