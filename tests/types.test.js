import { describe, it, expect } from "vitest";
import {
  isNormalizedRegion,
  uid,
  normalizeRegion,
  denormalizeRegion,
  ensureNormalized,
} from "../src/utils/types.js";

describe("region type helpers", () => {
  describe("isNormalizedRegion", () => {
    it("accepts normalized regions inside video bounds", () => {
      expect(isNormalizedRegion({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
      expect(isNormalizedRegion({ x: 0.2, y: 0.3, w: 0.4, h: 0.2 })).toBe(true);
    });

    it("rejects invalid normalized-looking regions", () => {
      expect(isNormalizedRegion({ x: 0.5, y: 0.5, w: 1, h: 1 })).toBe(false);
      expect(isNormalizedRegion({ x: -0.1, y: 0, w: 0.2, h: 0.2 })).toBe(false);
      expect(isNormalizedRegion({ x: NaN, y: 0, w: 0.2, h: 0.2 })).toBe(false);
    });

    it("returns false for null or undefined", () => {
      expect(isNormalizedRegion(null)).toBe(false);
      expect(isNormalizedRegion(undefined)).toBe(false);
    });

    it("accepts zero-size regions", () => {
      expect(isNormalizedRegion({ x: 0.5, y: 0.5, w: 0, h: 0 })).toBe(true);
    });
  });

  describe("uid", () => {
    it("generates unique identifiers", () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(uid());
      }
      expect(ids.size).toBe(100);
    });

    it("returns a string", () => {
      expect(typeof uid()).toBe("string");
    });
  });

  describe("normalizeRegion", () => {
    it("converts pixel coordinates to normalized 0..1", () => {
      const result = normalizeRegion({ x: 100, y: 200, w: 300, h: 150 }, 1000, 1000);
      expect(result).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.15 });
    });

    it("returns null when region is null", () => {
      expect(normalizeRegion(null, 1920, 1080)).toBe(null);
    });

    it("returns null when video dimensions are zero", () => {
      expect(normalizeRegion({ x: 0, y: 0, w: 100, h: 100 }, 0, 1080)).toBe(null);
      expect(normalizeRegion({ x: 0, y: 0, w: 100, h: 100 }, 1920, 0)).toBe(null);
    });
  });

  describe("denormalizeRegion", () => {
    it("converts normalized coordinates to pixel values", () => {
      const result = denormalizeRegion({ x: 0.1, y: 0.2, w: 0.3, h: 0.15 }, 1000, 1000);
      expect(result).toEqual({ x: 100, y: 200, w: 300, h: 150 });
    });

    it("returns null when region is null", () => {
      expect(denormalizeRegion(null, 1920, 1080)).toBe(null);
    });

    it("returns null when video dimensions are zero", () => {
      expect(denormalizeRegion({ x: 0, y: 0, w: 0.5, h: 0.5 }, 0, 1080)).toBe(null);
    });
  });

  describe("ensureNormalized", () => {
    it("returns already-normalized regions as-is", () => {
      const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
      expect(ensureNormalized(region, 1920, 1080)).toBe(region);
    });

    it("normalizes pixel-coordinate regions", () => {
      const result = ensureNormalized({ x: 192, y: 108, w: 384, h: 216 }, 1920, 1080);
      expect(result).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    });

    it("returns null for null input", () => {
      expect(ensureNormalized(null, 1920, 1080)).toBe(null);
    });

    it("does not collapse near-edge normalized regions via pixel reinterpretation", () => {
      // Float noise can make x+w slightly > 1; must stay near the original box.
      const region = { x: 0.81, y: 0.81, w: 0.2, h: 0.2 };
      const result = ensureNormalized(region, 1920, 1080);
      expect(result.x).toBeCloseTo(0.81, 5);
      expect(result.w).toBeCloseTo(0.2, 5);
      // Must not become ~0.81/1920
      expect(result.x).toBeGreaterThan(0.5);
    });
  });
});
