import { describe, it, expect } from "vitest";
import { letterSpacingToPx, letterSpacingForFfmpeg } from "../src/utils/letter-spacing.js";

describe("letter-spacing helpers", () => {
  it("letterSpacingToPx coerces invalid values to 0", () => {
    expect(letterSpacingToPx(undefined)).toBe(0);
    expect(letterSpacingToPx("bad")).toBe(0);
    expect(letterSpacingToPx(4.5)).toBe(4.5);
  });

  it("letterSpacingForFfmpeg clamps negative to 0 and rounds", () => {
    expect(letterSpacingForFfmpeg(-3)).toBe(0);
    expect(letterSpacingForFfmpeg(7.6)).toBe(8);
  });
});
