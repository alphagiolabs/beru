// Regression test for the processing-lock watchdog (shared-state.js).
// The lock must auto-release after PROCESSING_LOCK_MAX_MS so a future refactor
// that throws between beginProcessingRun and clearProcessingRun cannot wedge
// the app until restart.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

const sendToRenderer = vi.fn();
vi.mock("../main/utils/renderer.js", () => ({
  sendToRenderer: (...args) => sendToRenderer(...args),
}));

const {
  beginProcessingRun,
  clearProcessingRun,
  getProcessingRunId,
  getIsProcessing,
  setPythonProcess,
  PROCESSING_LOCK_MAX_MS,
} = await import("../main/shared-state.js");

describe("processing lock watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearProcessingRun();
    setPythonProcess(null);
    sendToRenderer.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("force-releases the lock after the max lifetime", async () => {
    expect(beginProcessingRun("run-1")).toBe(true);
    expect(getIsProcessing()).toBe(true);
    expect(getProcessingRunId()).toBe("run-1");

    vi.advanceTimersByTime(PROCESSING_LOCK_MAX_MS + 1);
    await vi.runAllTimersAsync();

    expect(getIsProcessing()).toBe(false);
    expect(getProcessingRunId()).toBe(null);
  });

  it("notifies the renderer with process:error on force-release", async () => {
    expect(beginProcessingRun("run-notify")).toBe(true);

    vi.advanceTimersByTime(PROCESSING_LOCK_MAX_MS + 1);
    await vi.runAllTimersAsync();

    expect(sendToRenderer).toHaveBeenCalled();
    expect(sendToRenderer.mock.calls[0][0]).toBe("process:error");
    const payload = sendToRenderer.mock.calls[0][1];
    expect(payload).toMatchObject({
      error: expect.stringMatching(/interrumpió|inesperada/i),
      runId: "run-notify",
    });
  });

  it("does not fire after a normal clearProcessingRun", () => {
    expect(beginProcessingRun("run-2")).toBe(true);
    expect(clearProcessingRun("run-2")).toBe(true);

    // Advancing past the deadline must be a no-op (timer was cancelled).
    vi.advanceTimersByTime(PROCESSING_LOCK_MAX_MS + 1);

    expect(getIsProcessing()).toBe(false);
    expect(getProcessingRunId()).toBe(null);
    expect(sendToRenderer).not.toHaveBeenCalled();
  });

  it("releases a wedged run so a new one can start afterwards", async () => {
    // Simulate the failure mode the watchdog exists for: beginProcessingRun
    // succeeds but clearProcessingRun is never called (e.g. a refactor throws
    // between the two). The watchdog must release the lock on its own.
    expect(beginProcessingRun("run-a")).toBe(true);
    // No clearProcessingRun("run-a") here — that's the whole point.

    vi.advanceTimersByTime(PROCESSING_LOCK_MAX_MS + 1);
    await vi.runAllTimersAsync();

    expect(getIsProcessing()).toBe(false);
    expect(getProcessingRunId()).toBe(null);

    // After the watchdog frees the lock, a fresh run must be accepted.
    expect(beginProcessingRun("run-b")).toBe(true);
    clearProcessingRun("run-b");
  });

  it("refuses to start a second run while one is active", () => {
    expect(beginProcessingRun("run-3")).toBe(true);
    expect(beginProcessingRun("run-4")).toBe(false);
    clearProcessingRun("run-3");
  });

  it("does not force-release while the processor child is still alive", () => {
    expect(beginProcessingRun("run-live")).toBe(true);
    setPythonProcess({ exitCode: null, signalCode: null, killed: false });

    // One watchdog tick rearms while the child is alive — do not runAllTimers
    // (that would loop forever on the rearm).
    vi.advanceTimersByTime(PROCESSING_LOCK_MAX_MS + 1);
    expect(getIsProcessing()).toBe(true);
    expect(getProcessingRunId()).toBe("run-live");
    expect(sendToRenderer).not.toHaveBeenCalled();

    setPythonProcess(null);
    vi.advanceTimersByTime(PROCESSING_LOCK_MAX_MS + 1);
    expect(getIsProcessing()).toBe(false);
    expect(getProcessingRunId()).toBe(null);
  });
});
