import { describe, it, expect } from "vitest";
import {
  binarySearchAutoFitFontSize,
  elementOverflows,
  getTextLayoutCss,
  verticalAlignToFlex,
  wrapTextToWidth,
} from "../src/utils/text-layout.js";
import { normalizeTextStyle, textStyleToPythonPayload } from "../src/utils/text-style.js";

describe("text-layout utilities", () => {
  it("maps vertical align to flex justification", () => {
    expect(verticalAlignToFlex("top")).toBe("flex-start");
    expect(verticalAlignToFlex("center")).toBe("center");
    expect(verticalAlignToFlex("bottom")).toBe("flex-end");
  });

  it("returns nowrap + ellipsis css when wrap is disabled", () => {
    expect(getTextLayoutCss({ textWrap: false, truncate: "ellipsis" })).toMatchObject({
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
    });
  });

  it("returns pre-wrap css when wrapping is enabled", () => {
    expect(getTextLayoutCss({ textWrap: true })).toMatchObject({
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    });
  });

  it("binarySearchAutoFitFontSize picks the largest fitting size", () => {
    const fits = (px) => px <= 20;
    expect(binarySearchAutoFitFontSize(fits, { minPx: 8, maxPx: 32 })).toBe(20);
  });

  it("wrapTextToWidth breaks long lines for export estimates", () => {
    const wrapped = wrapTextToWidth("one two three four five six", 80, 32);
    expect(wrapped.split("\n").length).toBeGreaterThan(1);
  });

  it("can measure overflow against explicit usable bounds", () => {
    const el = {
      scrollWidth: 118,
      scrollHeight: 28,
      clientWidth: 100,
      clientHeight: 24,
    };

    expect(elementOverflows(el)).toBe(true);
    expect(elementOverflows(el, 1, { width: 120, height: 32 })).toBe(false);
  });
});

describe("text-style layout contract", () => {
  it("normalizeTextStyle clamps layout fields", () => {
    const style = normalizeTextStyle({
      lineHeight: 9,
      safeMargin: 999,
      verticalAlign: "middle",
      truncate: "bogus",
    });
    expect(style.lineHeight).toBe(3);
    expect(style.safeMargin).toBe(48);
    expect(style.verticalAlign).toBe("top");
    expect(style.truncate).toBe("none");
  });

  it("textStyleToPythonPayload exports layout fields", () => {
    expect(
      textStyleToPythonPayload({
        autoFit: true,
        lineHeight: 1.35,
        verticalAlign: "center",
        textWrap: true,
        safeMargin: 6,
        truncate: "ellipsis",
      }),
    ).toEqual(
      expect.objectContaining({
        auto_fit: true,
        line_height: 1.35,
        vertical_align: "center",
        text_wrap: true,
        safe_margin: 6,
        truncate: "ellipsis",
      }),
    );
  });
});
