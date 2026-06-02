import { describe, it, expect } from "vitest";
import {
  pickTextStyle,
  mergeTextStyles,
  regionsMatch,
  findTextOpForRegion,
  patchToGlobalState,
} from "../src/utils/text-style.js";

describe("text-style utilities", () => {
  it("pickTextStyle keeps only known style keys", () => {
    expect(pickTextStyle({ fontSize: 24, foo: "bar" })).toEqual({ fontSize: 24 });
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

  it("patchToGlobalState maps fontSize to textFontSize", () => {
    expect(patchToGlobalState({ fontSize: 64, fontColor: "#fff" })).toEqual({
      textFontSize: 64,
      textFontColor: "#fff",
    });
  });
});