import { describe, expect, it } from "vitest";
import {
  appendLineToRun,
  createExecutionRun,
  finalizeExecutionRun,
  flattenExecutionHistory,
  normalizeExecutionHistory,
  prependExecutionRun,
  summarizeQueue,
} from "../src/utils/execution-history.js";

describe("execution history", () => {
  it("keeps previous runs when a new one starts", () => {
    const first = createExecutionRun({ kind: "batch", jobCount: 3 });
    let history = prependExecutionRun([], first);
    history = appendLineToRun(history, first.id, "run-1");
    history = finalizeExecutionRun(history, first.id, {
      total: 3,
      succeeded: 3,
      failed: 0,
    });

    const second = createExecutionRun({ kind: "batch", jobCount: 2 });
    history = prependExecutionRun(history, second);

    expect(history).toHaveLength(2);
    expect(history[1].lines).toEqual(["run-1"]);
    expect(history[0].id).toBe(second.id);
  });

  it("appends logs to the active run only", () => {
    const run = createExecutionRun({ kind: "batch", jobCount: 1 });
    let history = prependExecutionRun([], run);
    history = appendLineToRun(history, run.id, "ffmpeg start");
    history = appendLineToRun(history, run.id, "ffmpeg done");

    expect(history[0].lines).toEqual(["ffmpeg start", "ffmpeg done"]);
  });

  it("flattens runs with headers for export", () => {
    const run = createExecutionRun({ kind: "single", jobCount: 1 });
    let history = prependExecutionRun([], run);
    history = appendLineToRun(history, run.id, "line-a");
    history = finalizeExecutionRun(history, run.id, {
      total: 1,
      succeeded: 1,
      failed: 0,
    });

    const flat = flattenExecutionHistory(history);
    expect(flat.some((line) => line.includes("line-a"))).toBe(true);
    expect(flat[0]).toMatch(/^── /);
  });

  it("normalizes invalid persisted payloads", () => {
    expect(normalizeExecutionHistory([{ id: "x", startedAt: "2026-01-01T00:00:00.000Z" }])).toEqual(
      [
        expect.objectContaining({
          id: "x",
          lines: [],
          summary: null,
          kind: "batch",
        }),
      ],
    );
  });

  it("summarizes terminal queue items", () => {
    expect(
      summarizeQueue([
        { status: "done" },
        { status: "done" },
        { status: "error" },
        { status: "processing" },
      ]),
    ).toEqual({ total: 3, succeeded: 2, failed: 1 });
  });
});
