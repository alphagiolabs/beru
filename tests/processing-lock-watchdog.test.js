// Regression test for the processing-lock watchdog (shared-state.js).
// The lock must auto-release after PROCESSING_LOCK_MAX_MS so a future refactor
// that throws between beginProcessingRun and clearProcessingRun cannot wedge
// the app until restart.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

const {
  beginProcessingRun,
  clearProcessingRun,
  getProcessingRunId,
  getIsProcessing,
  PROCESSING_LOCK_MAX_MS,
} = await import("../main/shared-state.js");

describe("processing lock watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearProcessingRun();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("force-releases the lock after the max lifetime", () => {
    expect(beginProcessingRun("run-1")).toBe(true);
    expect(getIsProcessing()).toBe(true);
    expect(getProcessingRunId()).toBe("run-1");

    vi.advanceTimersByTime(PROCESSING_LOCK_MAX_MS + 1);

    expect(getIsProcessing()).toBe(false);
    expect(getProcessingRunId()).toBe(null);
  });

  it("does not fire after a normal clearProcessingRun", () => {
    expect(beginProcessingRun("run-2")).toBe(true);
    expect(clearProcessingRun("run-2")).toBe(true);

    // Advancing past the deadline must be a no-op (timer was cancelled).
    vi.advanceTimersByTime(PROCESSING_LOCK_MAX_MS + 1);

    expect(getIsProcessing()).toBe(false);
    expect(getProcessingRunId()).toBe(null);
  });

  it("releases a wedged run so a new one can start afterwards", () => {
    // Simulate the failure mode the watchdog exists for: beginProcessingRun
    // succeeds but clearProcessingRun is never called (e.g. a refactor throws
    // between the two). The watchdog must release the lock on its own.
    expect(beginProcessingRun("run-a")).toBe(true);
    // No clearProcessingRun("run-a") here — that's the whole point.

    vi.advanceTimersByTime(PROCESSING_LOCK_MAX_MS + 1);

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
});
