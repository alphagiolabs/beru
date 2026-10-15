import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_STYLE,
  normalizeOverlayStyle,
  validateOverlayStyle,
} from "../shared/overlay-style.js";

describe("title style", () => {
  it("fills every text option from Beru's defaults and keeps the values given", () => {
    const style = normalizeOverlayStyle({ size: 0.1, bold: true });
    expect(style).toEqual({ ...DEFAULT_OVERLAY_STYLE, size: 0.1, bold: true });
  });

  it("accepts a title saved before the text options existed", () => {
    expect(validateOverlayStyle({ color: "#ffcc00", size: 0.1 })).toBeNull();
    expect(validateOverlayStyle(DEFAULT_OVERLAY_STYLE)).toBeNull();
  });

  it("refuses values outside Beru's options", () => {
    expect(validateOverlayStyle({ fontFamily: "Comic Sans" })).toMatch(/fuente/);
    expect(validateOverlayStyle({ textAlign: "justify" })).toMatch(/alineación/);
    expect(validateOverlayStyle({ textOpacity: 1.2 })).toMatch(/opacidad del título/);
    expect(validateOverlayStyle({ bgOpacity: -0.1 })).toMatch(/opacidad del fondo/);
    expect(validateOverlayStyle({ borderWidth: 0.4 })).toMatch(/contorno/);
    expect(validateOverlayStyle({ bgColor: "red" })).toMatch(/#rrggbb/);
    expect(validateOverlayStyle({ bold: "yes" })).toMatch(/booleanos/);
  });
});
