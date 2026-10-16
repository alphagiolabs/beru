import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => {
  const api = {
    writeEditorAutosave: vi.fn(async () => ({ success: true })),
    setUnexportedWork: vi.fn(async () => true),
  };
  window.api = api;
  return api;
});

import App from "../src/App.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { useTimelineStore } from "../src/features/editor/store/useTimelineStore.js";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { setCanvas } from "../shared/editor-timeline.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;
let root;

beforeEach(() => {
  vi.useFakeTimers();
  useEditorStore.setState({ queue: [], sidebarMode: "editor", language: "es" });
  useTimelineStore.getState().open(createEmptyEditorProject());
  api.writeEditorAutosave.mockClear();
  api.setUnexportedWork.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function mount() {
  await import("../src/features/editor/EditorWorkspace.jsx");
  const element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () => root.render(<App />));
}

it("autosaves after leaving the editor before the debounce finishes", async () => {
  await mount();
  act(() => useTimelineStore.getState().apply((p) => setCanvas(p, { width: 800 })));
  act(() => useEditorStore.getState().setSidebarMode("logo"));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(api.writeEditorAutosave).toHaveBeenCalledOnce();
  expect(api.writeEditorAutosave.mock.calls[0][0].project.canvas.width).toBe(800);
});

it("reports unsaved montage work to main and flushes it before unload", async () => {
  await mount();
  act(() => useTimelineStore.getState().apply((p) => setCanvas(p, { width: 900 })));
  expect(api.setUnexportedWork).toHaveBeenLastCalledWith(true);
  await act(async () => window.dispatchEvent(new Event("beforeunload")));
  expect(api.writeEditorAutosave.mock.calls.at(-1)[0].project.canvas.width).toBe(900);
  act(() => {
    const state = useTimelineStore.getState();
    state.markSaved({ project: state.history.present, revision: state.revision });
  });
  expect(api.setUnexportedWork).toHaveBeenLastCalledWith(false);
});
