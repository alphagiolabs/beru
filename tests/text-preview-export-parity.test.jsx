import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import TextOverlay from "../src/components/TextOverlay.jsx";
import { layoutExportText, scaledSafeMargin } from "../src/utils/text-layout.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

function renderOverlay({ screen, text, style }) {
  root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(<TextOverlay screen={screen} text={text} style={style} />);
  });
}

function paintedLayout() {
  return document.querySelector("[data-export-layout]");
}

describe("text preview ↔ export parity", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
  });

  it("scales the safe margin purely (no artificial screen floor)", () => {
    const scale = 640 / 1920;
    expect(scaledSafeMargin(4, scale)).toBeCloseTo(4 * scale, 6);
    expect(scaledSafeMargin(4, scale)).toBeLessThan(2);
  });

  it("paints the scaled export insets without a 2px screen floor", () => {
    const scale = 0.25;
    renderOverlay({
      screen: { x: 0, y: 0, w: 160, h: 40, sx: scale, sy: scale },
      text: "Hola",
      style: { safeMargin: 2, bgEnabled: true, boxBorderWidth: 4 },
    });

    const container = paintedLayout().parentElement;
    expect(container.style.paddingTop).toBe("1.5px");
    expect(container.style.paddingLeft).toBe("1.5px");
  });

  it("paints the export layout scaled to screen px", () => {
    const scale = 0.5;
    const text = "one two three four five six";
    const screen = { x: 0, y: 0, w: 160, h: 40, sx: scale, sy: scale };
    renderOverlay({ screen, text, style: { fontSize: 24, safeMargin: 0, bgEnabled: false } });

    const layout = layoutExportText({
      text,
      regionW: screen.w / scale,
      regionH: screen.h / scale,
      fontSize: 24,
      lineHeight: 1.2,
      textWrap: true,
      autoFit: false,
      truncate: "none",
    });
    const painted = paintedLayout();
    expect(painted.getAttribute("data-display-text")).toBe(layout.displayText);
    expect(painted.style.fontSize).toBe(`${layout.fontSize * scale}px`);
    expect(painted.childElementCount).toBe(layout.displayText.split("\n").length);
  });
});
