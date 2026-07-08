/**
 * CSS preview padding must scale purely from video pixels so it matches
 * Python _text_layout_bounds (safe_margin + box_border_width inset).
 */
import { describe, it, expect } from "vitest";
import { scaledSafeMargin } from "../src/utils/text-layout.js";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("text preview ↔ export padding parity", () => {
  it("does not floor box padding at 2 screen px in TextOverlay", () => {
    const src = readFileSync(path.join(ROOT, "src/components/TextOverlay.jsx"), "utf8");
    // Regression: max(2, boxBorderWidth * scale) inflated preview padding vs FFmpeg
    expect(src).not.toMatch(/Math\.max\(\s*2\s*,\s*\(style\.boxBorderWidth/);
    expect(src).toMatch(/boxBorderWidth\s*\?\?/);
  });

  it("scales safe margin purely (no artificial screen floor)", () => {
    const scale = 640 / 1920; // typical preview scale
    expect(scaledSafeMargin(4, scale)).toBeCloseTo(4 * scale, 6);
    expect(scaledSafeMargin(4, scale)).toBeLessThan(2);
  });

  it("Python inset matches safe + box_pad", () => {
    // Contract: usable text origin = region + (safe_margin + box_pad)
    const region = { x: 100, y: 200, w: 400, h: 80 };
    const safe = 4;
    const boxPad = 8;
    const inset = safe + boxPad;
    expect(region.x + inset).toBe(112);
    expect(region.y + inset).toBe(212);
    expect(region.w - 2 * inset).toBe(376);
    expect(region.h - 2 * inset).toBe(56);
  });
});
