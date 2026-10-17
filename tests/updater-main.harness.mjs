import { vi } from "vitest";
import { IPC_EVENTS } from "../shared/ipc-channels.js";

export async function createUpdaterHarness() {
  const events = [];
  const handlers = new Map();
  let autoUpdater = null;
  let checkResolver = null;
  let downloadResolver = null;
  let downloadRejecter = null;

  function createRequireMock() {
    return (id) => {
      if (id === "electron-updater") {
        if (!autoUpdater) {
          autoUpdater = {
            autoDownload: true,
            autoInstallOnAppQuit: true,
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

  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => {
        if (channel === IPC_EVENTS.onUpdaterEvent) events.push(payload);
      },
    },
  };
  const cancelRun = vi.fn(() => Promise.resolve({ success: true, idle: true }));
  const setAppIsQuitting = vi.fn();
  vi.resetModules();
  vi.doMock("module", async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      default: { ...actual.default, createRequire: createRequireMock },
      createRequire: createRequireMock,
    };
  });
  vi.doMock("../main/shared-state.js", () => ({
    getMainWindow: () => fakeWindow,
    isDev: false,
    setAppIsQuitting,
  }));
  vi.doMock("../main/processing-run.js", () => ({ cancelRun }));
  const updater = await import("../main/updater.js");

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
    cancelRun,
    setAppIsQuitting,
    init: () => updater.init(fakeWindow),
  };
}
