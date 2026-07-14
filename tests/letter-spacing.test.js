import { describe, it, expect } from "vitest";
import {
  letterSpacingToPx,
  LETTER_SPACING_MAX,
  LETTER_SPACING_MIN,
} from "../src/utils/letter-spacing.js";
import { normalizeTextStyle, textStyleToPythonPayload } from "../src/utils/text-style.js";

describe("letterSpacingToPx", () => {
  describe("valid inputs", () => {
    it("coerces invalid values to 0", () => {
      expect(letterSpacingToPx(undefined)).toBe(0);
      expect(letterSpacingToPx(null)).toBe(0);
      expect(letterSpacingToPx("bad")).toBe(0);
      expect(letterSpacingToPx(NaN)).toBe(0);
    });

    it("returns in-range numeric values as-is", () => {
      expect(letterSpacingToPx(4.5)).toBe(4.5);
      expect(letterSpacingToPx(0)).toBe(0);
      expect(letterSpacingToPx(-2)).toBe(-2);
      expect(letterSpacingToPx(-20)).toBe(LETTER_SPACING_MIN);
    });

    it("clamps outside the shared export range", () => {
      expect(letterSpacingToPx(-99)).toBe(LETTER_SPACING_MIN);
      expect(letterSpacingToPx(999)).toBe(LETTER_SPACING_MAX);
    });

    it("parses numeric strings", () => {
      expect(letterSpacingToPx("3")).toBe(3);
      expect(letterSpacingToPx("2.5")).toBe(2.5);
      expect(letterSpacingToPx("-1.5")).toBe(-1.5);
    });
  });
});

describe("letter spacing preview/export parity", () => {
  it("normalizeTextStyle and letterSpacingToPx agree on negatives", () => {
    const raw = { letterSpacing: -5 };
    expect(normalizeTextStyle(raw).letterSpacing).toBe(-5);
    expect(letterSpacingToPx(raw.letterSpacing)).toBe(-5);
    expect(textStyleToPythonPayload(raw).letter_spacing).toBe(-5);
  });
});
