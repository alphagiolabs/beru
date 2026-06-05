import { describe, it, expect } from "vitest";
import {
  pickTextStyle,
  mergeTextStyles,
  regionsMatch,
  findTextOpForRegion,
  patchToGlobalState,
  normalizeTextStyle,
  textStyleToPythonPayload,
} from "../src/utils/text-style.js";

describe("text-style utilities", () => {
  it("pickTextStyle keeps only known style keys", () => {
    expect(
      pickTextStyle({
        fontSize: 24,
        textShadowEnabled: true,
        textShadowOffsetX: 3,
        foo: "bar",
      }),
    ).toEqual({ fontSize: 24, textShadowEnabled: true, textShadowOffsetX: 3 });
  });

  it("mergeTextStyles overlays later layers", () => {
    expect(mergeTextStyles({ fontSize: 32 }, { fontSize: 48, fontColor: "red" })).toEqual({
      fontSize: 48,
      fontColor: "red",
    });
  });

  it("regionsMatch compares all four normalized edges", () => {
    const a = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const b = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const c = { x: 0.1, y: 0.2, w: 0.5, h: 0.1 };
    expect(regionsMatch(a, b)).toBe(true);
    expect(regionsMatch(a, c)).toBe(false);
  });

  it("findTextOpForRegion matches by full region, not position only", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const sameSize = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const sameOrigin = { x: 0.1, y: 0.2, w: 0.5, h: 0.2 };
    const operations = [
      { id: "a", mode: "text", region: sameOrigin, text: "wrong" },
      { id: "b", mode: "text", region: sameSize, text: "right" },
    ];
    const { op, opIdx } = findTextOpForRegion(operations, region);
    expect(opIdx).toBe(1);
    expect(op.text).toBe("right");
  });

  it("findTextOpForRegion matches batch text by region id after an individual move", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.4, y: 0.3, w: 0.3, h: 0.1 };
    const operations = [
      { id: "a", mode: "text", batchRegionId: "r1", region: movedRegion, text: "right" },
      { id: "b", mode: "text", batchRegionId: "r2", region: templateRegion, text: "wrong" },
    ];

    const { op, opIdx } = findTextOpForRegion(operations, templateRegion, "r1");

    expect(opIdx).toBe(0);
    expect(op.text).toBe("right");
    expect(op.region).toEqual(movedRegion);
  });

  it("patchToGlobalState maps fontSize to textFontSize", () => {
    expect(
      patchToGlobalState({
        fontSize: 64,
        fontColor: "#fff",
        textShadowEnabled: true,
        textShadowColor: undefined,
      }),
    ).toEqual({
      textFontSize: 64,
      textFontColor: "#fff",
      textShadowEnabled: true,
    });
  });

  it("normalizeTextStyle clamps the full operation style contract", () => {
    const style = normalizeTextStyle({
      fontSize: 9999,
      textOpacity: -2,
      textAlign: "bogus",
      textShadowOffsetX: 999,
      textShadowOffsetY: -999,
    });

    expect(style.fontSize).toBe(200);
    expect(style.textOpacity).toBe(0);
    expect(style.textAlign).toBe("left");
    expect(style.textShadowOffsetX).toBe(64);
    expect(style.textShadowOffsetY).toBe(-64);
  });

  it("textStyleToPythonPayload is the FFmpeg adapter for text style", () => {
    expect(
      textStyleToPythonPayload({
        fontSize: 40,
        fontColor: "#fff",
        textShadowEnabled: true,
        textShadowOffsetX: 5,
      }),
    ).toEqual(
      expect.objectContaining({
        font_size: 40,
        font_color: "#fff",
        text_shadow_enabled: true,
        text_shadow_offset_x: 5,
      }),
    );
  });
});
