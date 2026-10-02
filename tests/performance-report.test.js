import { describe, expect, it } from "vitest";
import { summarize, checkStartupPanels, summarizeRuns } from "../scripts/performance/report.mjs";

describe("performance report contracts", () => {
  it("reports interpolated percentiles without discarding slow samples", () => {
    expect(summarize([100, 1, 4, 2, 3])).toEqual({
      count: 5,
      min: 1,
      median: 3,
      p90: expect.closeTo(61.6, 8),
      p95: expect.closeTo(80.8, 8),
      p99: expect.closeTo(96.16, 8),
      max: 100,
    });
    expect(summarize([42])).toEqual({
      count: 1,
      min: 42,
      median: 42,
      p90: 42,
      p95: 42,
      p99: 42,
      max: 42,
    });
    expect(summarize([])).toBeNull();
    expect(() => summarize([NaN])).toThrow();
  });

  it("detects a closed panel even when bundled into the entry instead of its own chunk", () => {
    const chunks = [
      { file: "assets/main-abc.js", modules: ["src/App.jsx", "src/components/SettingsModal.jsx"] },
      { file: "assets/TableEditor-def.js", modules: ["src/components/TableEditor.jsx"] },
    ];
    expect(checkStartupPanels(["file:///build/assets/main-abc.js"], chunks)).toEqual([
      { file: "assets/main-abc.js", module: "src/components/SettingsModal.jsx" },
    ]);
    expect(checkStartupPanels(["file:///build/assets/vendor.js"], chunks)).toEqual([]);
    expect(checkStartupPanels(["file:///build/assets/TableEditor-def.js?v=1"], chunks)).toEqual([
      { file: "assets/TableEditor-def.js", module: "src/components/TableEditor.jsx" },
    ]);
  });

  it("keeps scenarios separate, includes memory pressure, and excludes failed runs", () => {
    const phase = (name, elapsedMs, availableBytes, workingSetBytes) => ({
      name,
      elapsedMs,
      heapBytes: 12,
      frames: [16, 32],
      samples: [
        { availableBytes: availableBytes + 20, workingSetBytes: workingSetBytes - 10 },
        { availableBytes, workingSetBytes },
      ],
      action: { elapsedMs: [4, 8] },
    });
    const report = summarizeRuns([
      { phases: [phase("cold", 100, 40, 70), phase("warm", 5, 80, 30)] },
      { phases: [phase("cold", 200, 10, 90)] },
      { phases: [phase("cold", 9999, 0, 9999)], failure: "Window hidden" },
    ]);
    expect(report.cold.elapsedMs).toMatchObject({ count: 2, median: 150, max: 200 });
    expect(report.warm.elapsedMs).toMatchObject({ count: 1, median: 5 });
    expect(report.cold.availableMemoryMinBytes).toMatchObject({ min: 10, median: 25 });
    expect(report.cold.electronWorkingSetPeakBytes).toMatchObject({ median: 80, max: 90 });
    expect(report.cold.previewRequestMs).toMatchObject({ count: 4, median: 6 });
  });
});
