import React, { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import useZoomPan from "../src/components/video-preview/useZoomPan.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

function defineBox(el, box) {
  Object.defineProperties(el, {
    clientWidth: { configurable: true, value: box.clientWidth ?? box.width },
    clientHeight: { configurable: true, value: box.clientHeight ?? box.height },
    offsetWidth: { configurable: true, value: box.offsetWidth ?? box.width },
    offsetHeight: { configurable: true, value: box.offsetHeight ?? box.height },
  });
  el.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: box.width,
    bottom: box.height,
    width: box.width,
    height: box.height,
  });
}

function Harness({ panToolActive = false }) {
  const videoRef = useRef(null);
  const { outerRef, wrapperRef, pan, setZoomBoth, onPanMouseDown } = useZoomPan(videoRef, false, {
    panToolActive,
  });

  useEffect(() => {
    defineBox(outerRef.current, { width: 500, height: 360 });
    defineBox(wrapperRef.current, { width: 600, height: 360 });
    defineBox(videoRef.current, { width: 600, height: 360 });
    setZoomBoth(2);
  }, [outerRef, wrapperRef, setZoomBoth]);

  return (
    <div ref={outerRef} data-testid="outer" onMouseDown={onPanMouseDown}>
      <div ref={wrapperRef}>
        <video ref={videoRef} />
      </div>
      <output data-testid="pan">
        {pan.x},{pan.y}
      </output>
    </div>
  );
}

async function renderHarness(panToolActive) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(<Harness panToolActive={panToolActive} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function dragLeft(start, end) {
  await act(async () => {
    const outer = document.querySelector('[data-testid="outer"]');
    outer.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: start.x,
        clientY: start.y,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        button: 0,
        clientX: end.x,
        clientY: end.y,
      }),
    );
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
}

describe("useZoomPan", () => {
  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    document.body.innerHTML = "";
  });

  it("pans with the primary button when the pan tool is active", async () => {
    await renderHarness(true);
    await dragLeft({ x: 100, y: 100 }, { x: 220, y: 140 });

    expect(document.querySelector('[data-testid="pan"]').textContent).toBe("120,40");
  });

  it("does not pan with the primary button when the pan tool is inactive", async () => {
    await renderHarness(false);
    await dragLeft({ x: 100, y: 100 }, { x: 220, y: 140 });

    expect(document.querySelector('[data-testid="pan"]').textContent).toBe("0,0");
  });
});
