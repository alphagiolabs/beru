import { describe, it, expect, beforeEach, vi } from "vitest";
import { createUpdaterHarness } from "./updater-main.harness.mjs";

describe("main/updater.js cancel before quitAndInstall", () => {
  let harness;

  beforeEach(() => {
    harness = createUpdaterHarness();
    vi.useFakeTimers({ toFake: ["setImmediate", "setTimeout"] });
  });

  it("cancels active processing before calling quitAndInstall", async () => {
    harness.init();
    harness.emit("update-available", { version: "1.6.99" });
    const downloadPromise = harness.updater.startDownload();
    harness.resolveDownload();
    await downloadPromise;
    harness.emit("update-downloaded", { version: "1.6.99" });

    const result = harness.updater.install();
    expect(result.ok).toBe(true);

    // scheduleInstall uses setImmediate → cancel → quitAndInstall
    await vi.runAllTimersAsync();

    expect(harness.cancelActiveProcessing).toHaveBeenCalled();
    expect(harness.setAppIsQuitting).toHaveBeenCalledWith(true);
    expect(harness.autoUpdater.quitAndInstall).toHaveBeenCalled();
  });
});
