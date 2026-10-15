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
import useEditorStore from "../src/stores/useEditorStore.js";
import { useTimelineStore } from "../src/features/editor/store/useTimelineStore.js";
import { useEditorSession } from "../src/features/editor/store/useEditorSession.js";
import { createHistory } from "../src/features/editor/store/history.js";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, layoutTrack } from "../shared/editor-timeline.js";
import { appendClipFromAsset, setClipRange } from "../src/features/editor/editor-model.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SECOND = 1_000_000;

function montage() {
  let project = createEmptyEditorProject();
  const a = addAsset(project, {
    path: "C:/a.mp4",
    filename: "a.mp4",
    metadata: { durationUs: 10 * SECOND, width: 640, height: 360 },
  });
  project = appendClipFromAsset(a.project, a.assetId);
  const b = addAsset(project, {
    path: "C:/b.mp4",
    filename: "b.mp4",
    metadata: { durationUs: 3 * SECOND, width: 640, height: 360 },
  });
  project = appendClipFromAsset(b.project, b.assetId);
  project = setClipRange(project, layoutTrack(project)[0].clip.id, 0, 4);
  return project;
}

let container;
let root;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<EditorWorkspace />));
}

function press(key, options = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: options.code ?? "", ...options }),
    );
  });
}

const clipCount = () => layoutTrack(useTimelineStore.getState().history.present).length;
const selected = () => useEditorSession.getState().selectedClipId;

describe("timeline keyboard editing", () => {
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
      playhead: 0,
      playing: false,
      selectedClipId: layoutTrack(project)[0].clip.id,
    });
    mount();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("splits the clip under the playhead, selects the left half, and undoes the split in one step", () => {
    useEditorSession.setState({ playhead: 2 * SECOND });
    press("s");
    expect(clipCount()).toBe(3);
    expect(layoutTrack(useTimelineStore.getState().history.present)[0].clip.id).toBe(selected());
    press("z", { ctrlKey: true });
    expect(clipCount()).toBe(2);
  });

  it("does not split on a clip edge", () => {
    useEditorSession.setState({ playhead: 0 });
    press("s");
    expect(clipCount()).toBe(2);
  });

  it("duplicates the selected clip, sharing its source, and selects the copy", () => {
    press("d");
    expect(clipCount()).toBe(3);
    const [first, copy] = layoutTrack(useTimelineStore.getState().history.present);
    expect(copy.clip.assetId).toBe(first.clip.assetId);
    expect(selected()).toBe(copy.clip.id);
    expect(useTimelineStore.getState().history.present.assets).toHaveLength(2);
  });

  it("removes the selected clip with a ripple and selects its neighbour", () => {
    const [first, second] = layoutTrack(useTimelineStore.getState().history.present);
    press("Delete");
    expect(clipCount()).toBe(1);
    expect(layoutTrack(useTimelineStore.getState().history.present)[0]).toMatchObject({
      startUs: 0,
    });
    expect(selected()).toBe(second.clip.id);
    expect(first.clip.id).not.toBe(second.clip.id);
  });

  it("ignores edit shortcuts while a drag gesture is open", () => {
    useTimelineStore.getState().beginGesture();
    press("d");
    expect(clipCount()).toBe(2);
    useTimelineStore.getState().cancelGesture();
  });

  it("does not split while the user is typing in a range field", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    useEditorSession.setState({ playhead: 2 * SECOND });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    });
    expect(clipCount()).toBe(2);
    input.remove();
  });

  it("moves the playhead one frame per arrow press and toggles playback with Space", () => {
    press("ArrowRight");
    expect(useEditorSession.getState().playhead).toBe(Math.round(SECOND / 30));
    press(" ", { code: "Space" });
    expect(useEditorSession.getState().playing).toBe(true);
    press(" ", { code: "Space" });
    expect(useEditorSession.getState().playing).toBe(false);
  });
});
