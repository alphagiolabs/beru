import { describe, it, expect } from "vitest";
import { getBatchProgress } from "../src/utils/batch-progress.js";

const item = (status, progress = 0) => ({ status, progress });

describe("getBatchProgress", () => {
  it("returns 0% when nothing has started", () => {
    expect(getBatchProgress({
      queue: [item("idle"), item("idle")],
      progressDone: 0,
      progressTotal: 2,
    })).toEqual({ completed: 0, total: 2, percent: 0 });
  });

  it("uses in-flight encode percent while batch is running", () => {
    expect(getBatchProgress({
      queue: [item("processing", 50), item("idle")],
      progressDone: 0,
      progressTotal: 2,
    })).toEqual({ completed: 0, total: 2, percent: 25 });
  });

  it("combines completed jobs with active encodes under parallel workers", () => {
    expect(getBatchProgress({
      queue: [
        item("done"),
        item("done"),
        item("processing", 40),
        item("processing", 60),
      ],
      progressDone: 2,
      progressTotal: 5,
    })).toEqual({ completed: 2, total: 5, percent: 60 });
  });

  it("prefers queue terminal count when progressDone IPC lags", () => {
    expect(getBatchProgress({
      queue: [item("done"), item("error"), item("idle")],
      progressDone: 0,
      progressTotal: 3,
    })).toEqual({ completed: 2, total: 3, percent: 66.7 });
  });

  it("caps in-flight credit so percent never exceeds 100", () => {
    expect(getBatchProgress({
      queue: [
        item("processing", 100),
        item("processing", 100),
        item("processing", 100),
      ],
      progressDone: 0,
      progressTotal: 2,
    }).percent).toBe(100);
  });
});