// Unit tests for cancellingRunId helpers in shared-state.js

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

const {
  beginProcessingRun,
  clearProcessingRun,
  getCancellingRunId,
  setCancellingRunId,
  clearCancellingRunId,
  setPythonProcess,
} = await import("../main/shared-state.js");

describe("cancelling run id state", () => {
  beforeEach(() => {
    clearProcessingRun();
    clearCancellingRunId();
    setPythonProcess(null);
  });

  afterEach(() => {
    clearProcessingRun();
    clearCancellingRunId();
    setPythonProcess(null);
  });

  it("set/get/clear cancelling run id", () => {
    expect(getCancellingRunId()).toBe(null);
    setCancellingRunId("run-a");
    expect(getCancellingRunId()).toBe("run-a");
    expect(clearCancellingRunId("run-a")).toBe(true);
    expect(getCancellingRunId()).toBe(null);
  });

  it("clearCancellingRunId does not clear a different run", () => {
    setCancellingRunId("run-a");
    expect(clearCancellingRunId("run-b")).toBe(false);
    expect(getCancellingRunId()).toBe("run-a");
    clearCancellingRunId("run-a");
  });

  it("cancelling id is independent of begin/clear processing run", () => {
    expect(beginProcessingRun("run-1")).toBe(true);
    setCancellingRunId("run-1");
    clearProcessingRun("run-1");
    expect(getCancellingRunId()).toBe("run-1");
    clearCancellingRunId("run-1");
  });
});
