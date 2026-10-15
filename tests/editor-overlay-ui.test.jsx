import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

vi.hoisted(() => {
  const mock = {
    saveEditorProject: vi.fn(async () => ({
      success: true,
      filePath: "C:/m.beru-edit.json",
      revision: 0,
    })),
    writeEditorAutosave: vi.fn(async () => ({ success: true })),
    onEditorExportProgress: vi.fn(() => () => {}),
    cancelEditorExport: vi.fn(async () => ({ success: true, idle: true })),
  };
  window.api = mock;
});

import EditorWorkspace from "../src/features/editor/EditorWorkspace.jsx";
import OverlayInspector from "../src/features/editor/OverlayInspector.jsx";
import OverlayLayer from "../src/features/editor/OverlayLayer.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { useTimelineStore } from "../src/features/editor/store/useTimelineStore.js";
import { useEditorSession } from "../src/features/editor/store/useEditorSession.js";
import { createHistory } from "../src/features/editor/store/history.js";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, addTextOverlay, insertClip } from "../shared/editor-timeline.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SECOND = 1_000_000;

function montage() {
  const video = addAsset(createEmptyEditorProject(), {
    path: "C:/a.mp4",
    filename: "a.mp4",
    metadata: { durationUs: 10 * SECOND, width: 640, height: 360 },
  });
  const project = insertClip(video.project, {
    assetId: video.assetId,
    sourceOutUs: 4 * SECOND,
  }).project;
  return project;
}

let container;
let root;

function mount(element) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(element));
}

// React reads the value through the native setter, so a plain assignment would not reach its state.
function setInputValue(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const buttonNamed = (name, scope = container) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent.trim() === name);

const overlayCount = () => useTimelineStore.getState().history.present.overlays.length;

describe("overlay inspector", () => {
  const overlay = {
    id: "ov_1",
    kind: "text",
    startUs: SECOND,
    endUs: 3 * SECOND,
    text: "Hola",
    geometry: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 },
    style: { color: "#ffffff", size: 0.06 },
  };

  beforeEach(() => {
    useEditorStore.setState({ language: "es" });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("commits a changed text once, on blur, and never a value that did not change", () => {
    const onUpdate = vi.fn();
    mount(<OverlayInspector overlay={overlay} onUpdate={onUpdate} onRemove={() => {}} />);
    const text = container.querySelector('input[type="text"]');
    act(() => text.focus());
    act(() => text.blur());
    expect(onUpdate).not.toHaveBeenCalled();
    act(() => text.focus());
    act(() => {
      setInputValue(text, "Nuevo título");
    });
    act(() => text.blur());
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ text: "Nuevo título" });
  });

  it("refuses a blank title without changing the document", () => {
    const onUpdate = vi.fn();
    mount(<OverlayInspector overlay={overlay} onUpdate={onUpdate} onRemove={() => {}} />);
    const text = container.querySelector('input[type="text"]');
    act(() => text.focus());
    act(() => setInputValue(text, "   "));
    act(() => text.blur());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("converts the start time from seconds to microseconds", () => {
    const onUpdate = vi.fn();
    mount(<OverlayInspector overlay={overlay} onUpdate={onUpdate} onRemove={() => {}} />);
    const start = container.querySelectorAll('input[type="number"]')[0];
    act(() => start.focus());
    act(() => setInputValue(start, "2.5"));
    act(() => start.blur());
    expect(onUpdate).toHaveBeenCalledWith({ startUs: 2_500_000 });
  });

  it("removes the layer from its button", () => {
    const onRemove = vi.fn();
    mount(<OverlayInspector overlay={overlay} onUpdate={() => {}} onRemove={onRemove} />);
    act(() => buttonNamed("Quitar").click());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("toggles bold and the shadow as style patches", () => {
    const onUpdate = vi.fn();
    mount(<OverlayInspector overlay={overlay} onUpdate={onUpdate} onRemove={() => {}} />);
    act(() => buttonNamed("Negrita").click());
    expect(onUpdate).toHaveBeenLastCalledWith({ style: { bold: true } });
    act(() => buttonNamed("Sombra").click());
    expect(onUpdate).toHaveBeenLastCalledWith({ style: { textShadowEnabled: true } });
  });

  it("groups the text controls in tabs and shows one panel at a time", () => {
    mount(<OverlayInspector overlay={overlay} onUpdate={() => {}} onRemove={() => {}} />);
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Texto", "Estilo", "Posición"]);
    const shadowPanel = () => buttonNamed("Sombra").closest('[role="tabpanel"]');
    expect(shadowPanel().hidden).toBe(true);
    act(() => tabs[1].click());
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(shadowPanel().hidden).toBe(false);
    expect(container.querySelector('input[type="text"]').closest('[role="tabpanel"]').hidden).toBe(
      true,
    );
  });

  it("chooses the alignment from its list", () => {
    const onUpdate = vi.fn();
    mount(<OverlayInspector overlay={overlay} onUpdate={onUpdate} onRemove={() => {}} />);
    const trigger = container.querySelector('[role="combobox"][aria-label="Alineación"]');
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (el) => el.textContent.trim() === "Derecha",
    );
    act(() => option.click());
    expect(onUpdate).toHaveBeenLastCalledWith({ style: { textAlign: "right" } });
  });
});

describe("overlay layer in the preview", () => {
  const title = {
    id: "ov_1",
    kind: "text",
    startUs: SECOND,
    endUs: 3 * SECOND,
    text: "Visible",
    geometry: { x: 0, y: 0, w: 1, h: 0.25 },
    style: { color: "#ffcc00", size: 0.1 },
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows a title only while the playhead is inside its interval", () => {
    const render = (playhead) => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() =>
        root.render(
          <OverlayLayer overlays={[title]} playhead={playhead} assetsById={{}} assetStatus={{}} />,
        ),
      );
    };
    render(0);
    expect(container.textContent).toBe("");
    act(() => root.unmount());
    container.remove();
    render(2 * SECOND);
    const text = container.querySelector(".editor-overlay-text");
    expect(text.textContent).toBe("Visible");
    expect(text.style.color).toBe("rgb(255, 204, 0)");
    expect(text.style.top).toBe("0%");
    expect(text.style.height).toBe("25%");
  });

  it("draws the title's font, weight, alignment and background from its style", () => {
    const styled = {
      ...title,
      style: {
        ...title.style,
        bold: true,
        fontFamily: "Segoe UI",
        textAlign: "right",
        bgEnabled: true,
        bgOpacity: 0.5,
      },
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <OverlayLayer overlays={[styled]} playhead={2 * SECOND} assetsById={{}} assetStatus={{}} />,
      ),
    );
    const text = container.querySelector(".editor-overlay-text");
    expect(text.style.fontWeight).toBe("700");
    expect(text.style.fontFamily).toContain("Segoe UI");
    expect(text.style.textAlign).toBe("right");
    expect(text.style.justifyContent).toBe("flex-end");
    expect(text.style.background).toBe("rgba(0, 0, 0, 0.5)");
  });
});

describe("overlay editing in the workspace", () => {
  beforeEach(() => {
    useEditorStore.setState({ language: "es", sidebarMode: "editor" });
    const project = montage();
    useTimelineStore.setState({
      history: createHistory(project),
      revision: 0,
      savedRevision: null,
      cleanProject: project,
      lastError: null,
      filePath: null,
      assetStatus: {},
      previewPaths: {},
    });
    useEditorSession.setState({
      playhead: SECOND,
      playing: false,
      selectedClipId: null,
      selectedOverlayId: null,
    });
    mount(<EditorWorkspace />);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("adds a title at the playhead, selects it, and removes it with Delete", () => {
    act(() => buttonNamed("Título", container.querySelector(".editor-timeline-head")).click());
    expect(overlayCount()).toBe(1);
    const [overlay] = useTimelineStore.getState().history.present.overlays;
    expect(overlay).toMatchObject({ kind: "text", startUs: SECOND, text: "Título" });
    expect(useEditorSession.getState().selectedOverlayId).toBe(overlay.id);
    expect(container.querySelector(".editor-inspector")).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    });
    expect(overlayCount()).toBe(0);
    expect(useEditorSession.getState().selectedOverlayId).toBeNull();
  });

  it("selecting a clip clears the overlay selection", () => {
    let overlayId = null;
    useTimelineStore.getState().apply((p) => {
      const added = addTextOverlay(p, { startUs: 0, text: "x" });
      overlayId = added.overlayId;
      return added.project;
    });
    useEditorSession.getState().selectOverlay(overlayId);
    const clipId = useTimelineStore.getState().history.present.clips[0].id;
    useEditorSession.getState().selectClip(clipId);
    expect(useEditorSession.getState().selectedOverlayId).toBeNull();
    expect(useEditorSession.getState().selectedClipId).toBe(clipId);
  });
});

describe("custom canvas fields", () => {
  beforeEach(() => {
    useEditorStore.setState({ language: "es" });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("commits a typed width once, on blur", async () => {
    const { default: CanvasFields } = await import("../src/features/editor/CanvasFields.jsx");
    const onSize = vi.fn();
    mount(
      <CanvasFields
        canvas={{ width: 1920, height: 1080, background: "#000000" }}
        onSize={onSize}
      />,
    );
    const width = container.querySelectorAll('input[type="number"]')[0];
    act(() => width.focus());
    act(() => setInputValue(width, "1281"));
    act(() => width.blur());
    expect(onSize).toHaveBeenCalledTimes(1);
    expect(onSize).toHaveBeenCalledWith(1281, 1080);
  });
});

describe("image layer import", () => {
  beforeEach(() => {
    const project = montage();
    useTimelineStore.setState({
      history: createHistory(project),
      revision: 0,
      savedRevision: null,
      cleanProject: project,
      lastError: null,
      filePath: null,
      assetStatus: {},
      previewPaths: {},
    });
    useEditorSession.setState({
      playhead: SECOND,
      playing: false,
      selectedClipId: null,
      selectedOverlayId: null,
    });
  });

  it("imports a still as an asset and layers it at the playhead in one undo step", async () => {
    const { importImageLayer } = await import("../src/features/editor/editor-actions.js");
    const api = {
      importEditorImage: vi.fn(async () => ({
        success: true,
        source: {
          path: "C:/Images/logo.png",
          filename: "logo.png",
          sizeBytes: 64,
          mtimeMs: 7,
          metadata: { durationUs: null, width: 40, height: 40, hasAudio: false },
        },
      })),
    };
    const result = await importImageLayer(api, SECOND);
    expect(result.success).toBe(true);
    const state = useTimelineStore.getState();
    const [overlay] = state.history.present.overlays;
    expect(overlay).toMatchObject({ kind: "image", startUs: SECOND });
    expect(state.history.present.assets.map((a) => a.filename)).toEqual(["a.mp4", "logo.png"]);
    expect(state.assetStatus[overlay.assetId]).toBe("ready");
    expect(state.history.past).toHaveLength(1);
    expect(result.overlayId).toBe(overlay.id);
  });

  it("passes a cancelled picker through without touching the document", async () => {
    const { importImageLayer } = await import("../src/features/editor/editor-actions.js");
    const api = { importEditorImage: vi.fn(async () => ({ success: false, canceled: true })) };
    expect(await importImageLayer(api, SECOND)).toEqual({ success: false, canceled: true });
    expect(useTimelineStore.getState().history.present.overlays).toEqual([]);
    expect(useTimelineStore.getState().history.past).toHaveLength(0);
  });
});
