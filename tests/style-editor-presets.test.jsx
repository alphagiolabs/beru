import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import StyleEditor from "../src/components/StyleEditor.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { TEXT_STYLE_PRESETS } from "../src/utils/types.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseTextState = {
  textFontSize: 32,
  textFontColor: "white",
  fontFamily: "Arial",
  fontWeight: 400,
  letterSpacing: 0,
  textAlign: "left",
  textOpacity: 1,
  bold: false,
  italic: false,
  bgEnabled: true,
  bgColor: "black",
  bgOpacity: 0.65,
  boxBorderWidth: 4,
  borderWidth: 0,
  borderColor: "black",
  textShadowEnabled: false,
  textShadowColor: "black",
  textShadowOffsetX: 2,
  textShadowOffsetY: 2,
  autoFit: false,
  lineHeight: 1.2,
  verticalAlign: "top",
  textWrap: true,
  safeMargin: 4,
  truncate: "none",
};

const queueItem = (operations = []) => ({
  path: "C:\\videos\\sample.mp4",
  src: "",
  filename: "sample.mp4",
  width: 1920,
  height: 1080,
  duration: 10,
  videoCodec: "",
  pixFmt: "yuv420p",
  frameRate: 30,
  audioCodec: "",
  operations,
  status: "idle",
  progress: 0,
  eta: null,
  speed: null,
  error: null,
  customOutputName: "",
  thumbnail: null,
});

describe("StyleEditor text style presets", () => {
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useEditorStore.setState({
      ...baseTextState,
      sidebarMode: "logo",
      queue: [],
      selectedIdx: -1,
      templateRegions: [],
      selectedTemplateRegionId: null,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
  });

  function renderEditor() {
    root = createRoot(document.getElementById("root"));
    act(() => {
      root.render(<StyleEditor />);
    });
  }

  it("renders compact preset buttons and applies one to the global text style", () => {
    renderEditor();

    expect(document.querySelectorAll("[data-text-style-preset]")).toHaveLength(
      TEXT_STYLE_PRESETS.length,
    );

    act(() => {
      document
        .querySelector('[data-preset-id="ot-code"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useEditorStore.getState()).toEqual(
      expect.objectContaining({
        textFontColor: "#d7d7d7",
        fontFamily: "Arial",
        fontWeight: 400,
        bold: false,
        borderWidth: 1,
        borderColor: "#6b6b6b",
        textShadowEnabled: true,
        textShadowOffsetX: 1,
        textShadowOffsetY: 1,
      }),
    );
  });

  it("applies the soft gray preset without a background or outline", () => {
    renderEditor();

    act(() => {
      document
        .querySelector('[data-preset-id="soft-gray"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useEditorStore.getState()).toEqual(
      expect.objectContaining({
        textFontColor: "#d2d0d4",
        fontFamily: "Arial",
        fontWeight: 300,
        letterSpacing: 1,
        textOpacity: 0.92,
        bgEnabled: false,
        borderWidth: 0,
        textShadowEnabled: true,
        textShadowColor: "#4b4850",
        textShadowOffsetX: 1,
        textShadowOffsetY: 1,
      }),
    );
  });

  it("applies a preset to the selected batch template region and matching queue ops", () => {
    const region = { x: 0.1, y: 0.2, w: 0.4, h: 0.12 };
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontColor: "white" } }],
      queue: [
        queueItem([
          {
            id: "op-1",
            mode: "text",
            batchRegionId: "region-1",
            region: { ...region },
            text: "Promo",
            fontColor: "white",
          },
        ]),
      ],
    });
    renderEditor();

    act(() => {
      document
        .querySelector('[data-preset-id="blue-pop"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const state = useEditorStore.getState();
    expect(state.templateRegions[0].style).toEqual(
      expect.objectContaining({
        fontColor: "#168dff",
        fontFamily: "Segoe UI",
        fontWeight: 700,
        borderColor: "white",
        textShadowEnabled: true,
      }),
    );
    expect(state.queue[0].operations[0]).toEqual(
      expect.objectContaining({
        fontColor: "#168dff",
        fontFamily: "Segoe UI",
        fontWeight: 700,
        borderColor: "white",
        textShadowEnabled: true,
      }),
    );
  });
});
