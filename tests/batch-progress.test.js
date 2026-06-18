import { describe, it, expect } from "vitest";
import { getBatchProgress } from "../src/utils/batch-progress.js";

const item = (status, progress = 0) => ({ status, progress });

describe("getBatchProgress", () => {
  it("returns 0% when nothing has started", () => {
    expect(
      getBatchProgress({
        queue: [item("idle"), item("idle")],
        progressDone: 0,
        progressTotal: 2,
      }),
    ).toEqual({ completed: 0, total: 2, percent: 0 });
  });

  it("uses in-flight encode percent while batch is running", () => {
    expect(
      getBatchProgress({
        queue: [item("processing", 50), item("idle")],
        progressDone: 0,
        progressTotal: 2,
      }),
    ).toEqual({ completed: 0, total: 2, percent: 25 });
  });

  it("combines completed jobs with active encodes under parallel workers", () => {
    expect(
      getBatchProgress({
        queue: [item("done"), item("done"), item("processing", 40), item("processing", 60)],
        progressDone: 2,
        progressTotal: 5,
      }),
    ).toEqual({ completed: 2, total: 5, percent: 60 });
  });

  it("prefers queue terminal count when progressDone IPC lags", () => {
    expect(
      getBatchProgress({
        queue: [item("done"), item("error"), item("idle")],
        progressDone: 0,
        progressTotal: 3,
      }),
    ).toEqual({ completed: 2, total: 3, percent: 66.7 });
  });

  it("caps in-flight credit so percent never exceeds 100", () => {
    expect(
      getBatchProgress({
        queue: [item("processing", 100), item("processing", 100), item("processing", 100)],
        progressDone: 0,
        progressTotal: 2,
      }).percent,
    ).toBe(100);
  });

  it("returns zeros when queue is empty and total is 0", () => {
    expect(
      getBatchProgress({
        queue: [],
        progressDone: 0,
        progressTotal: 0,
      }),
    ).toEqual({ completed: 0, total: 0, percent: 0 });
  });

  it("uses queue.length as total when progressTotal is not provided", () => {
    expect(
      getBatchProgress({
        queue: [item("done"), item("idle")],
        progressDone: 0,
        progressTotal: 0,
      }),
    ).toEqual({ completed: 1, total: 2, percent: 50 });
  });

  it("ignores non-finite progress values from processing items", () => {
    expect(
      getBatchProgress({
        queue: [item("processing", NaN), item("processing", -5), item("idle")],
        progressDone: 0,
        progressTotal: 3,
      }),
    ).toEqual({ completed: 0, total: 3, percent: 0 });
  });

  it("reports 100% when all jobs are done", () => {
    expect(
      getBatchProgress({
        queue: [item("done"), item("done"), item("error")],
        progressDone: 3,
        progressTotal: 3,
      }),
    ).toEqual({ completed: 3, total: 3, percent: 100 });
  });

  describe("jobProgress map (VITE_BERU_RENDER_PROGRESS_MAP)", () => {
    it("reads in-flight progress from jobProgress instead of item.progress", () => {
      expect(
        getBatchProgress({
          // item.progress is stale (0) — real progress lives in jobProgress
          queue: [item("processing", 0), item("idle")],
          progressDone: 0,
          progressTotal: 2,
          jobProgress: { 0: 50 },
        }),
      ).toEqual({ completed: 0, total: 2, percent: 25 });
    });

    it("falls back to item.progress when jobProgress lacks the index", () => {
      expect(
        getBatchProgress({
          queue: [item("processing", 40), item("idle")],
          progressDone: 0,
          progressTotal: 2,
          jobProgress: {},
        }),
      ).toEqual({ completed: 0, total: 2, percent: 20 });
    });

    it("ignores jobProgress for terminal jobs", () => {
      expect(
        getBatchProgress({
          queue: [item("done"), item("processing", 0)],
          progressDone: 1,
          progressTotal: 2,
          jobProgress: { 0: 99, 1: 60 },
        }).percent,
      ).toBe(80);
    });
  });
});
