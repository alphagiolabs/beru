import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import TextOverlay from "../src/components/TextOverlay.jsx";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;
let originals = {};

function restoreMetricGetters() {
  for (const [prop, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
    else delete HTMLElement.prototype[prop];
  }
  originals = {};
}

function mockMeasurerMetrics({ scrollWidth, scrollHeight }) {
  restoreMetricGetters();
  for (const prop of ["scrollWidth", "scrollHeight", "clientWidth", "clientHeight"]) {
    originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
  }

  Object.defineProperties(HTMLElement.prototype, {
    scrollWidth: {
      configurable: true,
      get() {
        return this.dataset?.overflowMeasurer ? scrollWidth : 0;
      },
    },
    scrollHeight: {
      configurable: true,
      get() {
        return this.dataset?.overflowMeasurer ? scrollHeight : 0;
      },
    },
    clientWidth: {
      configurable: true,
      get() {
        if (!this.dataset?.overflowMeasurer) return 0;
        return Number.parseFloat(this.style.width) || 0;
      },
    },
    clientHeight: {
      configurable: true,
      get() {
        if (!this.dataset?.overflowMeasurer) return 0;
        return Number.parseFloat(this.style.maxHeight) || 0;
      },
    },
  });
}

function renderOverlay(style = {}) {
  root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(
      <TextOverlay
        screen={{ x: 0, y: 0, w: 160, h: 50, sx: 1, sy: 1 }}
        text="Texto de ejemplo"
        style={{
          fontSize: 24,
          safeMargin: 4,
          bgEnabled: true,
          // boxPad + safeMargin inset matches Python _text_layout_bounds
          boxBorderWidth: 4,
          ...style,
        }}
      />,
    );
  });
}

describe("TextOverlay overflow warning", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    restoreMetricGetters();
  });

  it("does not mark overflow when text fits the usable safe area", () => {
    // usable = 160 - 2*4(safe) - 2*4(boxPad) = 144 wide; 50 - 8 - 8 = 34 tall
    mockMeasurerMetrics({ scrollWidth: 140, scrollHeight: 28 });
    renderOverlay();

    const measurer = document.querySelector("[data-overflow-measurer]");
    expect(measurer.style.width).toBe("144px");
    expect(measurer.style.maxHeight).toBe("34px");
    expect(measurer.style.padding).toBe("0px");
    expect(document.body.textContent).not.toMatch(/Desborda/i);
  });

  it("marks overflow when measured text exceeds the usable safe area", () => {
    mockMeasurerMetrics({ scrollWidth: 140, scrollHeight: 48 });
    renderOverlay();

    expect(document.body.textContent).toMatch(/Desborda/i);
  });
});
