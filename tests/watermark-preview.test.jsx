import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import WatermarkOverlay from "../src/components/video-preview/WatermarkOverlay.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { PROJECT_TYPE, PROJECT_VERSION } from "../shared/project-document.js";
import positions from "../resources/watermark-position-fixtures.json" with { type: "json" };
import { WATERMARK_POSITIONS } from "../src/utils/watermark-position.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
});

describe("restored image watermark preview", () => {
  it("shows the local image after loading a project without embedded image data", async () => {
    useEditorStore.setState({ queue: [], templateRegions: [], excelRows: [] });
    const previousApi = window.api;
    window.api = {
      ...previousApi,
      loadProject: async () => ({
        success: true,
        data: {
          type: PROJECT_TYPE,
          version: PROJECT_VERSION,
          watermark: { enabled: true, type: "image", imagePath: "C:\\images\\logo #1.png" },
        },
      }),
    };
    try {
      await useEditorStore.getState().loadProject();
    } finally {
      window.api = previousApi;
    }
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
  it("offers every contract position", () => {
    expect(WATERMARK_POSITIONS.map((p) => p.key)).toEqual(
      positions.cases.filter((c) => c.listed).map((c) => c.position),
    );
  });

  it.each(positions.cases.flatMap((c) => ["text", "image"].map((type) => [c.id, type, c])))(
    "%s (%s) matches export coordinates",
    (_id, type, c) => {
      document.body.innerHTML = '<div id="root"></div>';
      root = createRoot(document.getElementById("root"));
      act(() =>
        root.render(
          <WatermarkOverlay
            watermark={{
              type,
              text: "WM",
              imagePath: "C:\\mark.png",
              ...("position" in c ? { position: c.position } : {}),
            }}
            videoRef={{ current: { videoHeight: 360, offsetWidth: 640, offsetHeight: 360 } }}
          />,
        ),
      );
      const { style } = document.getElementById("root").firstElementChild.firstElementChild;
      const centeredX =
        style.transform === "translateX(-50%)" || style.transform === "translate(-50%, -50%)";
      const centeredY =
        style.transform === "translateY(-50%)" || style.transform === "translate(-50%, -50%)";
      const x = style.right
        ? positions.frame.width - Number.parseFloat(style.right) - positions.mark.width
        : style.left.endsWith("%")
          ? (positions.frame.width * Number.parseFloat(style.left)) / 100 -
            (centeredX ? positions.mark.width / 2 : 0)
          : Number.parseFloat(style.left);
      const y = style.bottom
        ? positions.frame.height - Number.parseFloat(style.bottom) - positions.mark.height
        : style.top.endsWith("%")
          ? (positions.frame.height * Number.parseFloat(style.top)) / 100 -
            (centeredY ? positions.mark.height / 2 : 0)
          : Number.parseFloat(style.top);
      expect({ x, y }).toEqual(c.expected);
    },
  );

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
