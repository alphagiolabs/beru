import { describe, it, expect } from "vitest";
import { drawtextLineSpacingPx, verticalAlignToFlex } from "../src/utils/text-layout.js";

describe("text-layout utilities", () => {
  it("maps vertical align to flex justification", () => {
    expect(verticalAlignToFlex("top")).toBe("flex-start");
    expect(verticalAlignToFlex("center")).toBe("center");
    expect(verticalAlignToFlex("bottom")).toBe("flex-end");
  });

  it("drawtextLineSpacingPx matches FFmpeg round(font_size * (line_height-1))", () => {
    expect(drawtextLineSpacingPx(32, 1.2)).toBe(6);
    expect(drawtextLineSpacingPx(24, 1.2)).toBe(5);
    expect(drawtextLineSpacingPx(32, 1)).toBe(0);
  });
});
