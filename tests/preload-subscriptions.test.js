import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { IPC_INVOKE, IPC_EVENTS } from "../shared/ipc-channels.js";

const preloadSource = readFileSync(path.join(process.cwd(), "main", "preload.cjs"), "utf8");

const mocks = vi.hoisted(() => ({ handlers: new Map() }));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
  app: { isPackaged: false, getPath: () => "/tmp/beru-test", getVersion: () => "0.0.0" },
  dialog: {},
  shell: {},
  BrowserWindow: class {},
}));

const handlerModules = await Promise.all([
  import("../main/handlers/dialog.js"),
  import("../main/handlers/drop.js"),
  import("../main/handlers/file.js"),
  import("../main/handlers/pet-overlay.js"),
  import("../main/handlers/petdex.js"),
  import("../main/handlers/preset.js"),
  import("../main/handlers/process.js"),
  import("../main/handlers/project.js"),
  import("../main/handlers/recent.js"),
  import("../main/handlers/settings.js"),
  import("../main/handlers/system.js"),
  import("../main/handlers/updater.js"),
  import("../main/handlers/video.js"),
]);

for (const mod of handlerModules) {
  for (const exported of Object.values(mod)) {
    if (typeof exported === "function" && exported.name.startsWith("register")) {
      exported({});
    }
  }
}

function loadApi() {
  const ipcRenderer = new EventEmitter();
  ipcRenderer.invoke = vi.fn(async () => undefined);
  const exposeInMainWorld = vi.fn();
  runInNewContext(preloadSource, {
    require: () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer,
      webUtils: { getPathForFile: (f) => f?.path || "" },
    }),
  });
  const [name, api] = exposeInMainWorld.mock.calls[0];
  expect(name).toBe("api");
  return { api, ipcRenderer };
}

describe("ipc channel contract (shared/ipc-channels.js)", () => {
  it("ipcMain.register* functions register exactly the IPC_INVOKE channels", () => {
    const registered = [...mocks.handlers.keys()].sort();
    expect(registered).toEqual(Object.values(IPC_INVOKE).sort());
  });

  it("each IPC_INVOKE entry is exposed on window.api under its own name", () => {
    const { api, ipcRenderer } = loadApi();
    for (const [name, channel] of Object.entries(IPC_INVOKE)) {
      expect(typeof api[name], `api.${name}`).toBe("function");
      api[name]("arg");
      expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(channel, "arg");
    }
  });

  it("window.api exposes exactly IPC_INVOKE + IPC_EVENTS + getPathForFile", () => {
    const { api } = loadApi();
    expect(Object.keys(api).sort()).toEqual(
      [...Object.keys(IPC_INVOKE), ...Object.keys(IPC_EVENTS), "getPathForFile"].sort(),
    );
  });
});

describe("preload subscriptions", () => {
  it.each(Object.entries(IPC_EVENTS))(
    "%s forwards payloads and removes only its own listener",
    (method, channel) => {
      const { api, ipcRenderer } = loadApi();

      const first = vi.fn();
      const second = vi.fn();
      const unsubscribeFirst = api[method](first);
      const unsubscribeSecond = api[method](second);
      const payload = { index: 2, runId: "run-a" };
      ipcRenderer.emit(channel, { sender: "main" }, payload);
      expect(first).toHaveBeenCalledTimes(1);
      expect(first).toHaveBeenCalledWith(payload);
      expect(second).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledWith(payload);

      unsubscribeFirst();
      ipcRenderer.emit(channel, {}, "next");
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenLastCalledWith("next");
      expect(ipcRenderer.listenerCount(channel)).toBe(1);

      unsubscribeSecond();
      expect(ipcRenderer.listenerCount(channel)).toBe(0);
    },
  );
});
