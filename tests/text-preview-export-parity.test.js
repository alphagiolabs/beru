import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  layoutExportText,
  scaledSafeMargin,
  textBoxPad,
  textLayoutBounds,
} from "../src/utils/text-layout.js";
import contract from "../resources/text-layout-fixtures.json" with { type: "json" };

const ROOT = path.resolve(import.meta.dirname, "..");

describe("text preview ↔ export padding parity", () => {
  it("does not floor box padding at 2 screen px in TextOverlay", () => {
    const src = readFileSync(path.join(ROOT, "src/components/TextOverlay.jsx"), "utf8");
    expect(src).not.toMatch(/Math\.max\(\s*2\s*,\s*\(style\.boxBorderWidth/);
    expect(src).toMatch(/textBoxPad\(/);
  });

  it("scales safe margin purely (no artificial screen floor)", () => {
    const scale = 640 / 1920;
    expect(scaledSafeMargin(4, scale)).toBeCloseTo(4 * scale, 6);
    expect(scaledSafeMargin(4, scale)).toBeLessThan(2);
  });

  it("shared helpers match the versioned layout contract", () => {
    for (const c of contract.bounds_cases) {
      const boxPad = textBoxPad(c.op);
      expect(boxPad, c.id).toBe(c.expected.box_pad);
      expect(textLayoutBounds(c.region, c.safe_margin, boxPad), c.id).toEqual(c.expected.bounds);
    }
  });

  it("TextOverlay paints with the export wrap/fit pipeline, not CSS pre-wrap", () => {
    const src = readFileSync(path.join(ROOT, "src/components/TextOverlay.jsx"), "utf8");
    expect(src).toMatch(/layoutExportText\(/);
    expect(src).toMatch(/drawtextLineSpacingPx\(/);
    expect(src).not.toMatch(/getTextLayoutCss\(/);
    expect(src).not.toMatch(/data-overflow-measurer/);
  });
});

describe("text preview ↔ export wrap/fit/truncate parity", () => {
  it.each(contract.layout_cases.map((c) => [c.id, c]))(
    "layout case %s matches fixture",
    (_id, c) => {
      expect(
        layoutExportText({
          text: c.text,
          regionW: c.region_w,
          regionH: c.region_h,
          fontSize: c.font_size,
          lineHeight: c.line_height,
          textWrap: c.text_wrap,
          autoFit: c.auto_fit,
          truncate: c.truncate,
        }),
      ).toEqual({
        fontSize: c.expected.font_size,
        displayText: c.expected.display_text,
      });
    },
  );
});
