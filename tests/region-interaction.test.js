import { describe, it, expect } from "vitest";
import {
  applyMove,
  applyResize,
  cursorForHandle,
  pointerDeltaToNorm,
  RESIZE_HANDLES,
} from "../src/utils/region-interaction.js";

describe("region-interaction", () => {
  const start = { x: 0.2, y: 0.3, w: 0.3, h: 0.2 };

  it("exports eight resize handles", () => {
    expect(RESIZE_HANDLES).toHaveLength(8);
  });

  it("maps handle cursors", () => {
    expect(cursorForHandle("tl")).toBe("nwse-resize");
    expect(cursorForHandle("mr")).toBe("ew-resize");
    expect(cursorForHandle("bc")).toBe("ns-resize");
  });

  it("converts pointer deltas using content size (zoom-aware)", () => {
    const d = pointerDeltaToNorm(
      { clientX: 100, clientY: 50 },
      { clientX: 200, clientY: 150 },
      { width: 1000, height: 500 },
    );
    expect(d.dx).toBeCloseTo(0.1);
    expect(d.dy).toBeCloseTo(0.2);
  });

  it("moves a region and clamps to the frame", () => {
    const moved = applyMove(start, 0.1, -0.05);
    expect(moved.x).toBeCloseTo(0.3);
    expect(moved.y).toBeCloseTo(0.25);
    expect(moved.w).toBeCloseTo(0.3);
    expect(moved.h).toBeCloseTo(0.2);

    const clamped = applyMove(start, 1, 1);
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(1.0001);
    expect(clamped.y + clamped.h).toBeLessThanOrEqual(1.0001);
  });

  it("resizes from the bottom-right corner", () => {
    const next = applyResize(start, "br", 0.05, 0.05);
    expect(next.x).toBeCloseTo(0.2);
    expect(next.y).toBeCloseTo(0.3);
    expect(next.w).toBeCloseTo(0.35);
    expect(next.h).toBeCloseTo(0.25);
  });

  it("resizes from the top-left corner and keeps min size", () => {
    const next = applyResize(start, "tl", 0.5, 0.5);
    expect(next.w).toBeGreaterThanOrEqual(0.01);
    expect(next.h).toBeGreaterThanOrEqual(0.01);
  });

  it("resizes from the right edge only", () => {
    const next = applyResize(start, "mr", 0.1, 0);
    expect(next.x).toBeCloseTo(0.2);
    expect(next.y).toBeCloseTo(0.3);
    expect(next.w).toBeCloseTo(0.4);
    expect(next.h).toBeCloseTo(0.2);
  });
});
