import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import TextOverlay from "../src/components/TextOverlay.jsx";
import { layoutExportText, textBoxPad, textLayoutBounds } from "../src/utils/text-layout.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

function renderOverlay(style = {}, { screen, text } = {}) {
  root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(
      <TextOverlay
        screen={screen ?? { x: 0, y: 0, w: 160, h: 50, sx: 1, sy: 1 }}
        text={text ?? "Texto de ejemplo"}
        style={{
          fontSize: 24,
          safeMargin: 4,
          bgEnabled: true,
          boxBorderWidth: 4,
          ...style,
        }}
      />,
    );
  });
}

describe("TextOverlay export-layout preview", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
  });

  it("paints wrapped lines from the shared export layout, not a DOM measurer", () => {
    renderOverlay();

    expect(document.querySelector("[data-overflow-measurer]")).toBeNull();
    const painted = document.querySelector("[data-export-layout]");
    expect(painted).toBeTruthy();

    const bounds = textLayoutBounds(
      { x: 0, y: 0, w: 160, h: 50 },
      4,
      textBoxPad({ bgEnabled: true, boxBorderWidth: 4 }),
    );
    const layout = layoutExportText({
      text: "Texto de ejemplo",
      regionW: bounds.w,
      regionH: bounds.h,
      fontSize: 24,
      lineHeight: 1.2,
      textWrap: true,
      autoFit: false,
      truncate: "none",
    });
    expect(painted.getAttribute("data-display-text")).toBe(layout.displayText);
    expect(painted.getAttribute("data-font-size")).toBe(String(layout.fontSize));
    expect(layout.displayText).toBe("Texto de\nejemplo");
  });

  it("does not mark overflow when autoFit shrinks text to the usable area", () => {
    renderOverlay({ autoFit: true });
    expect(document.body.textContent).not.toMatch(/Desborda/i);
  });

  it("marks overflow when export layout exceeds the usable safe area", () => {
    renderOverlay();
    expect(document.body.textContent).toMatch(/Desborda/i);
  });

  it("pins each line box to drawtext line spacing (no CSS half-leading)", () => {
    renderOverlay({ lineHeight: 1.2, fontSize: 24 });
    const line = document.querySelector("[data-export-layout] > div");
    expect(line.style.lineHeight).toBe("24px");
    expect(line.style.height).toBe("29px");
    expect(line.style.whiteSpace).toBe("pre");
  });
});
