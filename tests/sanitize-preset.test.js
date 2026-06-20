import { describe, it, expect } from "vitest";
import {
  sanitizeTemplateRegions,
  sanitizeTextStyle,
  sanitizeDefaults,
} from "../src/utils/sanitize-preset.js";

describe("sanitize-preset", () => {
  describe("sanitizeTemplateRegions", () => {
    it("drops regions with absurd dimensions", () => {
      const regions = sanitizeTemplateRegions([
        { id: 1, label: "BAD", region: { x: 0, y: 0, w: 5000, h: 5000 } },
        { id: 2, label: "OK", region: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } },
      ]);
      expect(regions).toHaveLength(1);
      expect(regions[0].label).toBe("OK");
      expect(regions[0].region.w).toBeLessThanOrEqual(1);
    });

    it("normalizes pixel-coordinate template regions", () => {
      const regions = sanitizeTemplateRegions([
        { id: 1, label: "PX", region: { x: 96, y: 54, w: 192, h: 108 } },
      ]);

      expect(regions).toHaveLength(1);
      expect(regions[0].region).toEqual({
        x: 0.05,
        y: 0.05,
        w: 0.1,
        h: 0.1,
      });
    });

    it("returns empty array for non-array input", () => {
      expect(sanitizeTemplateRegions(null)).toEqual([]);
      expect(sanitizeTemplateRegions(undefined)).toEqual([]);
    });

    it("skips null or non-object entries", () => {
      const regions = sanitizeTemplateRegions([
        null,
        { id: 1, label: "OK", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
        "bad",
      ]);
      expect(regions).toHaveLength(1);
    });

    it("truncates labels longer than 64 characters", () => {
      const longLabel = "x".repeat(100);
      const regions = sanitizeTemplateRegions([
        { id: 1, label: longLabel, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      ]);
      expect(regions[0].label.length).toBe(64);
    });
  });

  describe("sanitizeTextStyle", () => {
    it("clamps text style numeric fields", () => {
      const style = sanitizeTextStyle({
        textFontSize: 9999,
        textOpacity: 4,
        letterSpacing: -5,
        textShadowEnabled: true,
        textShadowOffsetX: 999,
        textShadowOffsetY: -999,
      });
      expect(style.textFontSize).toBe(200);
      expect(style.textOpacity).toBe(1);
      expect(style.letterSpacing).toBe(0);
      expect(style.textShadowEnabled).toBe(true);
      expect(style.textShadowOffsetX).toBe(64);
      expect(style.textShadowOffsetY).toBe(-64);
    });

    it("truncates textInput to 2000 characters", () => {
      const longText = "a".repeat(2500);
      const style = sanitizeTextStyle({ textInput: longText });
      expect(style.textInput.length).toBe(2000);
    });

    it("handles empty input gracefully", () => {
      const style = sanitizeTextStyle({});
      expect(style).toBeDefined();
      expect(typeof style.textFontSize).toBe("number");
    });
  });

  describe("sanitizeDefaults", () => {
    it("clamps blurStrength to valid range", () => {
      expect(sanitizeDefaults({ blurStrength: 500 }).blurStrength).toBe(100);
      expect(sanitizeDefaults({ blurStrength: -10 }).blurStrength).toBe(1);
      expect(sanitizeDefaults({ blurStrength: 50 }).blurStrength).toBe(50);
    });

    it("validates delogoMethod", () => {
      expect(sanitizeDefaults({ delogoMethod: "mirror" }).delogoMethod).toBe("mirror");
      expect(sanitizeDefaults({ delogoMethod: "invalid" }).delogoMethod).toBe("temporal");
      expect(sanitizeDefaults({ delogoMethod: null }).delogoMethod).toBe("temporal");
    });

    it("validates mirrorSide", () => {
      expect(sanitizeDefaults({ mirrorSide: "left" }).mirrorSide).toBe("left");
      expect(sanitizeDefaults({ mirrorSide: "invalid" }).mirrorSide).toBe("right");
      expect(sanitizeDefaults({ mirrorSide: null }).mirrorSide).toBe("right");
    });

    it("clamps temporalRadius and mosaicSize", () => {
      expect(sanitizeDefaults({ temporalRadius: 100 }).temporalRadius).toBe(15);
      expect(sanitizeDefaults({ mosaicSize: 200 }).mosaicSize).toBe(80);
    });

    it("clamps edgeFeather and delogoFillOpacity", () => {
      expect(sanitizeDefaults({ edgeFeather: 100 }).edgeFeather).toBe(40);
      expect(sanitizeDefaults({ delogoFillOpacity: 2 }).delogoFillOpacity).toBe(1);
      expect(sanitizeDefaults({ delogoFillOpacity: -1 }).delogoFillOpacity).toBe(0);
    });

    it("truncates delogoFillColor", () => {
      const longColor = "#" + "f".repeat(50);
      const result = sanitizeDefaults({ delogoFillColor: longColor });
      expect(result.delogoFillColor.length).toBe(32);
    });

    it("uses fallback values for NaN inputs", () => {
      expect(sanitizeDefaults({ blurStrength: NaN }).blurStrength).toBe(20);
      expect(sanitizeDefaults({ temporalRadius: NaN }).temporalRadius).toBe(3);
    });
  });
});
