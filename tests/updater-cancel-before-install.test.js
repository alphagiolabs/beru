import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUpdaterHarness } from "./updater-main.harness.mjs";

describe("main/updater.js cancel before quitAndInstall", () => {
  let harness;

  beforeEach(() => {
    // Fake timers must be installed before the harness VM captures setTimeout/
    // setImmediate, otherwise grace-period tests cannot advance INSTALL_GRACE_MS.
    vi.useFakeTimers({ toFake: ["setImmediate", "setTimeout"] });
    harness = createUpdaterHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function downloadReady() {
    harness.init();
    harness.emit("update-available", { version: "1.6.99" });
    const downloadPromise = harness.updater.startDownload();
    harness.resolveDownload();
    await downloadPromise;
    harness.emit("update-downloaded", { version: "1.6.99" });
  }

  it("cancels active processing before calling quitAndInstall", async () => {
    await downloadReady();

    const result = harness.updater.install();
    expect(result.ok).toBe(true);

    // scheduleInstall uses setImmediate → cancel → quitAndInstall
    await vi.runAllTimersAsync();

    expect(harness.cancelActiveProcessing).toHaveBeenCalled();
    expect(harness.setAppIsQuitting).toHaveBeenCalledWith(true);
    expect(harness.autoUpdater.quitAndInstall).toHaveBeenCalled();
  });

  it("resets appIsQuitting when install grace timeout fires", async () => {
    await downloadReady();

    const result = harness.updater.install();
    expect(result.ok).toBe(true);

    // Advance past setImmediate so quitAndInstall runs, but quit does not exit
    // the process in this harness — grace timeout should abort the sticky flags.
    await vi.runAllTimersAsync();

    expect(harness.setAppIsQuitting).toHaveBeenCalledWith(true);
    expect(harness.setAppIsQuitting).toHaveBeenCalledWith(false);
    expect(harness.events.some((e) => e.type === "error")).toBe(true);
    // Retry must be allowed after grace abort.
    expect(harness.updater.isQuittingForUpdate()).toBe(false);
  });

  it("resets appIsQuitting when quitAndInstall throws", async () => {
    await downloadReady();

    // Replace quitAndInstall after download so install() can still load the module.
    harness.autoUpdater.quitAndInstall = vi.fn(() => {
      throw new Error("install spawn failed");
    });

    const result = harness.updater.install();
    expect(result.ok).toBe(true);

    await vi.advanceTimersByTimeAsync(0); // flush setImmediate only

    expect(harness.setAppIsQuitting).toHaveBeenCalledWith(true);
    expect(harness.setAppIsQuitting).toHaveBeenCalledWith(false);
    expect(harness.events.some((e) => e.type === "error")).toBe(true);
  });
});
