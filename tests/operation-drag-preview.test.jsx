import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import useOperationDrag from "../src/components/video-preview/useOperationDrag.js";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("disables regional editing when an existing preview switches to the exact overlay", () => {
  const sel = {
    path: "C:/clip.mp4",
    operations: [{ id: "blur", mode: "blur", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
  };
  useEditorStore.setState({ queue: [sel], selectedIdx: 0, selectedOperationIdx: 0 });
  const video = document.createElement("video");
  Object.defineProperties(video, { videoWidth: { value: 320 }, videoHeight: { value: 180 } });
  const props = {
    videoRef: { current: video },
    sel,
    sidebarMode: "logo",
    activeTool: "blur",
    currentRegion: null,
    selectedOperationIdx: 0,
    showFfmpegPreview: true,
    layoutTick: 0,
  };
  let editing;
  function Probe(values) {
    editing = useOperationDrag(values).selectedRegionOp;
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(Probe, { ...props, showFfmpegOverlay: false })));
    expect(editing?.op.id).toBe("blur");
    act(() => root.render(createElement(Probe, { ...props, showFfmpegOverlay: true })));
    expect(editing).toBeNull();
    act(() => root.render(createElement(Probe, { ...props, showFfmpegOverlay: false })));
    expect(editing?.op.id).toBe("blur");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
