import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import WatermarkOverlay from "../src/components/video-preview/WatermarkOverlay.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { PROJECT_TYPE, PROJECT_VERSION } from "../shared/project-document.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
});

describe("restored image watermark preview", () => {
  it("shows the local image after loading a project without embedded image data", () => {
    useEditorStore.setState({ queue: [], templateRegions: [], excelRows: [] });
    useEditorStore.getState()._applyProject({
      type: PROJECT_TYPE,
      version: PROJECT_VERSION,
      watermark: { enabled: true, type: "image", imagePath: "C:\\images\\logo #1.png" },
    });
    const watermark = useEditorStore.getState().watermark;
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    act(() =>
      root.render(
        <WatermarkOverlay
          watermark={watermark}
          videoRef={{
            current: { videoHeight: 360, offsetWidth: 640, offsetHeight: 360 },
          }}
        />,
      ),
    );
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "beru://local/C%3A%5Cimages%5Clogo%20%231.png",
    );
  });
});

describe("watermark preview layout", () => {
  it("lays out from the unzoomed video box and keeps FFmpeg's bottom-right margin", () => {
    const video = {
      videoHeight: 360,
      offsetWidth: 640,
      offsetHeight: 360,
      getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    act(() =>
      root.render(
        <WatermarkOverlay
          watermark={{ type: "text", text: "WM", fontSize: 18, position: "bottom-right" }}
          videoRef={{ current: video }}
        />,
      ),
    );
    const box = document.getElementById("root").firstElementChild;
    expect(box.style.width).toBe("640px");
    expect(box.style.height).toBe("360px");
    const label = box.firstElementChild;
    expect(label.style.right).toBe("10px");
    expect(label.style.bottom).toBe("10px");
    expect(label.style.fontSize).toBe("18px");
  });
});
