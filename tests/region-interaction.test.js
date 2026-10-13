import { describe, it, expect } from "vitest";
import {
  applyMove,
  applyResize,
  applyResizeRaw,
  cursorForHandle,
  fitRegionToAspect,
  pointerDeltaToNorm,
  regionFromFieldPixels,
} from "../src/utils/region-interaction.js";

describe("region-interaction", () => {
  const start = { x: 0.2, y: 0.3, w: 0.3, h: 0.2 };

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

  it("applyResizeRaw grows from br without clamping past the frame", () => {
    const edge = { x: 0.7, y: 0.7, w: 0.2, h: 0.2 };
    const raw = applyResizeRaw(edge, "br", 0.2, 0.2);
    expect(raw.x).toBeCloseTo(0.7);
    expect(raw.y).toBeCloseTo(0.7);
    expect(raw.w).toBeCloseTo(0.4);
    expect(raw.h).toBeCloseTo(0.4);
    expect(raw.x + raw.w).toBeGreaterThan(1);

    const clamped = applyResize(edge, "br", 0.2, 0.2);
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(1.0001);
    expect(clamped.y + clamped.h).toBeLessThanOrEqual(1.0001);
  });

  it("applyResizeRaw keeps min size from the top-left handle", () => {
    const raw = applyResizeRaw(start, "tl", 0.5, 0.5);
    expect(raw.w).toBeGreaterThanOrEqual(0.01);
    expect(raw.h).toBeGreaterThanOrEqual(0.01);
  });

  it("maps typed pixel values to a clamped region and ignores non-finite input", () => {
    const dims = { w: 1920, h: 1080 };
    expect(regionFromFieldPixels(start, "x", 384, dims).x).toBeCloseTo(0.2, 10);
    expect(regionFromFieldPixels(start, "y", 540.4, dims).y).toBe(540 / 1080);
    expect(regionFromFieldPixels(start, "x", 5000, dims).x).toBeCloseTo(1 - start.w, 10);
    expect(regionFromFieldPixels(start, "w", Number.NaN, dims)).toBeNull();
    expect(regionFromFieldPixels(start, "w", 100, { w: 0, h: 0 })).toBeNull();
  });

  it("re-proportions a region around its centre inside the frame", () => {
    const dims = { w: 1920, h: 1080 };
    const next = fitRegionToAspect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 16 / 9, dims);
    expect((next.w * dims.w) / (next.h * dims.h)).toBeCloseTo(16 / 9, 2);
    expect(next.x + next.w / 2).toBeCloseTo(0.5, 2);
    expect(next.y + next.h / 2).toBeCloseTo(0.5, 2);
  });

  it("keeps a re-proportioned region inside the frame when it sits in a corner", () => {
    const dims = { w: 1920, h: 1080 };
    const next = fitRegionToAspect({ x: 0.9, y: 0, w: 0.1, h: 0.5 }, 9 / 16, dims);
    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.x + next.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(next.y).toBeGreaterThanOrEqual(0);
    expect(next.y + next.h).toBeLessThanOrEqual(1 + 1e-9);
    expect((next.w * dims.w) / (next.h * dims.h)).toBeCloseTo(9 / 16, 2);
  });

  it("returns null when the source size is unknown", () => {
    expect(fitRegionToAspect(start, 1, { w: 0, h: 0 })).toBeNull();
  });

  it("keeps the proportion of a minimum-size region on a portrait source", () => {
    const dims = { w: 1080, h: 1920 };
    const next = fitRegionToAspect({ x: 0.4, y: 0.4, w: 0.01, h: 0.01 }, 16 / 9, dims);
    expect((next.w * dims.w) / (next.h * dims.h)).toBeCloseTo(16 / 9, 6);
    const pixelW = Math.round(next.w * dims.w);
    const pixelH = Math.round(next.h * dims.h);
    expect(Math.abs(pixelW / pixelH - 16 / 9) / (16 / 9)).toBeLessThan(0.01);
  });
});
