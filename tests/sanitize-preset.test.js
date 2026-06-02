import { describe, it, expect } from "vitest";
import {
  sanitizeTemplateRegions,
  sanitizeTextStyle,
} from "../src/utils/sanitize-preset.js";

describe("sanitize-preset", () => {
  it("drops regions with absurd dimensions", () => {
    const regions = sanitizeTemplateRegions([
      { id: 1, label: "BAD", region: { x: 0, y: 0, w: 5000, h: 5000 } },
      { id: 2, label: "OK", region: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } },
    ]);
    expect(regions).toHaveLength(1);
    expect(regions[0].label).toBe("OK");
    expect(regions[0].region.w).toBeLessThanOrEqual(1);
  });

  it("clamps text style numeric fields", () => {
    const style = sanitizeTextStyle({
      textFontSize: 9999,
      textOpacity: 4,
      letterSpacing: -5,
    });
    expect(style.textFontSize).toBe(200);
    expect(style.textOpacity).toBe(1);
    expect(style.letterSpacing).toBe(0);
  });
});