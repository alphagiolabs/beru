import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";
import { vi } from "vitest";

/**
 * Test harness for main/updater.js.
 *
 * We run the real source in a VM with mocked electron and electron-updater so we
 * can deterministically reproduce the event sequences that cause update flow bugs.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "..", "main", "updater.js");

function buildSource() {
  let src = fs.readFileSync(sourcePath, "utf-8");
  // Replace the static electron import with a variable that the VM will inject.
  src = src.replace('import { app } from "electron";', "const app = globalThis.__mockElectronApp;");
  src = src.replace(
    'import { createRequire } from "module";',
    "const createRequire = globalThis.__mockCreateRequire;",
  );
  // The updater reads the live window from shared-state instead of a captured
  // ref (so it survives window recreation). Inject a mock getter that returns
  // the test's fake window. Wrapped in a function so the lookup happens at call
  // time (fakeWindow is created after runInContext, so binding the value at
  // module top-level would capture undefined).
  src = src.replace(
    'import { getMainWindow } from "./shared-state.js";',
    "const getMainWindow = () => globalThis.__mockGetMainWindow && globalThis.__mockGetMainWindow();",
  );
  // The source uses import.meta.url for createRequire. Replace with a fixed URL.
  src = src.replace(/import\.meta\.url/g, '"file:///test/updater.js"');
  // Convert ESM export to CommonJS module.exports so vm.runInContext can return it.
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
            autoDownload: false,
            autoInstallOnAppQuit: false,
            logger: null,
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
  // Make the VM's globalThis point to itself so globalThis.__mockX works.
  context.globalThis = context;
  context.__mockElectronApp = fakeApp;
  context.__mockCreateRequire = createRequireMock;

  const module = { exports: {} };
  context.module = module;
  context.exports = module.exports;

  const src = buildSource();
  vm.runInContext(src, context, { filename: sourcePath });

  const updater = context.module.exports;

  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (_channel, payload) => events.push(payload),
    },
  };
  // shared-state.getMainWindow() mock — returns the test's fake window so send()
  // (which now reads the live window instead of a captured ref) targets it.
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
    init: () => updater.init(fakeWindow),
  };
}
