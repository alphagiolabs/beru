import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import path from "node:path";

const source = readFileSync(path.join(process.cwd(), "main", "preload.cjs"), "utf8");
const subscriptions = [
  ["onPetOverlayState", "petOverlay:state"],
  ["onPetOverlayEvent", "petOverlay:event"],
  ["onUpdaterEvent", "updater:event"],
  ["onProgress", "process:progress"],
  ["onJobProgress", "process:jobProgress"],
  ["onComplete", "process:complete"],
  ["onSummary", "process:summary"],
  ["onJobError", "process:jobError"],
  ["onJobCancelled", "process:jobCancelled"],
  ["onFinished", "process:finished"],
  ["onRunStarted", "process:runStarted"],
  ["onError", "process:error"],
  ["onLog", "process:log"],
];

describe("preload subscriptions", () => {
  it.each(subscriptions)(
    "%s forwards payloads and removes only its own listener",
    (method, channel) => {
      const ipcRenderer = new EventEmitter();
      const exposeInMainWorld = vi.fn();
      runInNewContext(source, {
        require: () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer }),
      });
      const [name, api] = exposeInMainWorld.mock.calls[0];
      expect(name).toBe("api");

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
