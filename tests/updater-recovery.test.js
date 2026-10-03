import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdaterHarness } from "./updater-main.harness.mjs";

describe("download recovery", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("keeps the download locked during retries and reports the final rejection once", async () => {
    const harness = createUpdaterHarness();
    harness.init();
    harness.emit("update-available", { version: "1.6.99" });
    const download = harness.updater.startDownload();
    for (const delay of [3000, 6000]) {
      harness.emit("error", new Error("Offline"));
      harness.rejectDownload(new Error("Offline"));
      await Promise.resolve();
      expect(await harness.updater.checkForUpdates()).toMatchObject({
        ok: false,
        reason: "download-in-progress",
      });
      expect(await harness.updater.startDownload()).toMatchObject({
        ok: true,
        reason: "already-downloading",
      });
      expect(harness.events.at(-1).type).toBe("downloading");
      await vi.advanceTimersByTimeAsync(delay);
    }
    harness.emit("error", new Error("Offline"));
    harness.rejectDownload(new Error("Offline"));
    expect(await download).toMatchObject({ ok: false, error: "Offline" });
    expect(harness.events.filter((item) => item.type === "error")).toHaveLength(1);
    expect(harness.updater.getSnapshot()).toMatchObject({
      recoverTo: "available",
      version: "1.6.99",
    });
    const retry = harness.updater.startDownload();
    harness.emit("update-downloaded", { version: "1.6.99" });
    harness.resolveDownload();
    expect(await retry).toMatchObject({ ok: true });
    expect(harness.updater.getSnapshot().type).toBe("ready");
  });
  it.each(["ERR_UPDATER_INVALID_SIGNATURE", "ERR_CHECKSUM_MISMATCH"])(
    "rejects %s immediately without retrying an untrusted download",
    async (code) => {
      const harness = createUpdaterHarness();
      harness.init();
      harness.emit("update-available", { version: "1.6.99" });
      const download = harness.updater.startDownload();
      const failure = Object.assign(new Error("Unsafe installer"), { code });
      harness.emit("error", failure);
      harness.rejectDownload(failure);
      expect(await download).toMatchObject({ ok: false, error: code });
      expect(harness.updater.getSnapshot()).toMatchObject({
        type: "error",
        recoverTo: "available",
        message: code,
      });
      expect(harness.updater.install()).toMatchObject({
        ok: false,
        error: "update-not-downloaded",
      });
    },
  );
});
