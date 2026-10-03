import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUpdaterHarness } from "./updater-main.harness.mjs";

describe("main/updater.js cancel before quitAndInstall", () => {
  let harness;

  beforeEach(() => {
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

    await vi.runAllTimersAsync();

    expect(harness.cancelRun).toHaveBeenCalled();
    expect(harness.setAppIsQuitting).toHaveBeenCalledWith(true);
    expect(harness.autoUpdater.quitAndInstall).toHaveBeenCalled();

    expect(harness.cancelRun.mock.invocationCallOrder[0]).toBeLessThan(
      harness.autoUpdater.quitAndInstall.mock.invocationCallOrder[0],
    );
  });

  it("resets appIsQuitting when install grace timeout fires", async () => {
    await downloadReady();

    const result = harness.updater.install();
    expect(result.ok).toBe(true);

    await vi.runAllTimersAsync();

    expect(harness.setAppIsQuitting).toHaveBeenCalledWith(true);
    expect(harness.setAppIsQuitting).toHaveBeenCalledWith(false);
    expect(harness.events.some((e) => e.type === "error")).toBe(true);
    expect(harness.updater.isQuittingForUpdate()).toBe(false);
  });

  it("resets appIsQuitting when quitAndInstall throws", async () => {
    await downloadReady();

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
  it("does not install after cancellation rejects", async () => {
    await downloadReady();
    harness.cancelRun.mockRejectedValue(new Error("Worker did not stop"));
    harness.updater.install();
    await vi.runAllTimersAsync();
    expect(harness.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(harness.updater.isQuittingForUpdate()).toBe(false);
    expect(harness.updater.getSnapshot()).toMatchObject({
      type: "error",
      recoverTo: "ready",
      message: "Worker did not stop",
    });
  });

  it("does not spawn an installer after a cancellation timeout expires", async () => {
    await downloadReady();
    let finishCancellation;
    harness.cancelRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCancellation = resolve;
        }),
    );
    harness.updater.install();
    await vi.advanceTimersByTimeAsync(10000);
    finishCancellation();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(harness.updater.isQuittingForUpdate()).toBe(false);
  });

  it("recovers immediately from electron-updater installation error events", async () => {
    await downloadReady();
    harness.autoUpdater.quitAndInstall.mockImplementation(() =>
      harness.emit("error", new Error("Spawn denied")),
    );
    harness.updater.install();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.updater.isQuittingForUpdate()).toBe(false);
    expect(harness.updater.getSnapshot()).toMatchObject({
      type: "error",
      recoverTo: "ready",
      message: "Spawn denied",
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(harness.updater.getSnapshot().message).toBe("Spawn denied");
  });

  it("does not let an expired install attempt overtake a new cancellation", async () => {
    await downloadReady();
    const cancellations = [];
    harness.cancelRun.mockImplementation(
      () => new Promise((resolve) => cancellations.push(resolve)),
    );
    harness.updater.install();
    await vi.advanceTimersByTimeAsync(10000);
    harness.updater.install();
    await vi.advanceTimersByTimeAsync(0);
    cancellations[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    cancellations[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
