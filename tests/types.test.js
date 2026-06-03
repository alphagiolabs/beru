import { describe, it, expect } from "vitest";
import { isNormalizedRegion } from "../src/utils/types.js";

describe("region type helpers", () => {
  it("accepts normalized regions inside video bounds", () => {
    expect(isNormalizedRegion({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isNormalizedRegion({ x: 0.2, y: 0.3, w: 0.4, h: 0.2 })).toBe(true);
  });

  it("rejects invalid normalized-looking regions", () => {
    expect(isNormalizedRegion({ x: 0.5, y: 0.5, w: 1, h: 1 })).toBe(false);
    expect(isNormalizedRegion({ x: -0.1, y: 0, w: 0.2, h: 0.2 })).toBe(false);
    expect(isNormalizedRegion({ x: NaN, y: 0, w: 0.2, h: 0.2 })).toBe(false);
  });
});
