import { describe, it, expect } from "vitest";
import { letterSpacingToPx, letterSpacingForFfmpeg } from "../src/utils/letter-spacing.js";

describe("letterSpacingToPx", () => {
  describe("valid inputs", () => {
    it("coerces invalid values to 0", () => {
      expect(letterSpacingToPx(undefined)).toBe(0);
      expect(letterSpacingToPx(null)).toBe(0);
      expect(letterSpacingToPx("bad")).toBe(0);
      expect(letterSpacingToPx(NaN)).toBe(0);
    });

    it("returns numeric values as-is", () => {
      expect(letterSpacingToPx(4.5)).toBe(4.5);
      expect(letterSpacingToPx(0)).toBe(0);
      expect(letterSpacingToPx(-2)).toBe(-2);
    });

    it("parses numeric strings", () => {
      expect(letterSpacingToPx("3")).toBe(3);
      expect(letterSpacingToPx("2.5")).toBe(2.5);
    });
  });
});

describe("letterSpacingForFfmpeg", () => {
  it("clamps negative to 0 and rounds", () => {
    expect(letterSpacingForFfmpeg(-3)).toBe(0);
    expect(letterSpacingForFfmpeg(7.6)).toBe(8);
  });

  it("returns 0 for non-finite input", () => {
    expect(letterSpacingForFfmpeg(NaN)).toBe(0);
    expect(letterSpacingForFfmpeg(undefined)).toBe(0);
  });

  it("rounds 0.5 to nearest integer", () => {
    expect(letterSpacingForFfmpeg(0.5)).toBe(1);
    expect(letterSpacingForFfmpeg(0)).toBe(0);
  });
});
