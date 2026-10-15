import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

const api = vi.hoisted(() => {
  const mock = {
    importEditorVideos: vi.fn(async () => ({ success: false, canceled: true })),
    openEditorProject: vi.fn(async () => ({ success: false, canceled: true })),
    saveEditorProject: vi.fn(async () => ({
      success: true,
      filePath: "C:/m.beru-edit.json",
      revision: 0,
    })),
    writeEditorAutosave: vi.fn(async () => ({ success: true })),
    exportEditorComposition: vi.fn(async () => ({ success: false, canceled: true })),
    cancelEditorExport: vi.fn(async () => ({ success: true, idle: true })),
    pickEditorReplacement: vi.fn(async () => ({ success: false, canceled: true })),
    renderEditorExactFrame: vi.fn(() => new Promise(() => {})),
    onEditorExportProgress: vi.fn(() => () => {}),
  };
  window.api = mock;
  return mock;
});

import EditorWorkspace from "../src/features/editor/EditorWorkspace.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { useTimelineStore } from "../src/features/editor/store/useTimelineStore.js";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, addImageOverlay, insertClip } from "../shared/editor-timeline.js";
import { createHistory } from "../src/features/editor/store/history.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<EditorWorkspace />);
  });
}

function buttonWithText(text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
}

function resetDocument(project) {
  useTimelineStore.setState({
    history: createHistory(project),
    revision: project.revision,
    savedRevision: null,
    cleanProject: project,
    lastError: null,
    filePath: null,
    assetStatus: {},
  });
}

describe("EditorWorkspace", () => {
  beforeEach(() => {
    useEditorStore.setState({ language: "es", sidebarMode: "editor" });
    resetDocument(createEmptyEditorProject());
    Object.values(api).forEach((fn) => fn.mockClear?.());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the toolbar, an empty library and no export while there is no clip", () => {
    mount();
    expect(container.textContent).toContain("Biblioteca");
    expect(container.textContent).toContain("Importa videos para empezar.");
    expect(buttonWithText("Exportar MP4").disabled).toBe(true);
    expect(buttonWithText("Abrir")).toBeTruthy();
  });

  it("explains a missing source and keeps it out of the montage until it is located", () => {
    const added = addAsset(createEmptyEditorProject(), {
      path: "C:/Videos/gone.mp4",
      filename: "gone.mp4",
      sizeBytes: 1,
      mtimeMs: 1,
      metadata: { durationUs: 4_000_000, width: 640, height: 360 },
    });
    const project = insertClip(added.project, { assetId: added.assetId }).project;
    resetDocument(project);
    useTimelineStore.setState({ assetStatus: { [added.assetId]: "missing" } });
    mount();
    expect(container.textContent).toContain("Archivo no encontrado");
    expect(buttonWithText("Buscar archivo")).toBeTruthy();
    expect(buttonWithText("Exportar MP4").disabled).toBe(true);
  });

  it("blocks the export while the image of a layer is missing", () => {
    const video = addAsset(createEmptyEditorProject(), {
      path: "C:/Videos/a.mp4",
      filename: "a.mp4",
      sizeBytes: 1,
      mtimeMs: 1,
      metadata: { durationUs: 4_000_000, width: 640, height: 360 },
    });
    const image = addAsset(insertClip(video.project, { assetId: video.assetId }).project, {
      path: "C:/Logos/logo.png",
      filename: "logo.png",
      sizeBytes: 1,
      mtimeMs: 1,
      metadata: { durationUs: null, width: 40, height: 40 },
    });
    resetDocument(addImageOverlay(image.project, { assetId: image.assetId, startUs: 0 }).project);
    useTimelineStore.setState({ assetStatus: { [image.assetId]: "missing" } });
    mount();
    expect(buttonWithText("Exportar MP4").disabled).toBe(true);
  });

  it("exports with the quality profile chosen in the export panel", async () => {
    const added = addAsset(createEmptyEditorProject(), {
      path: "C:/Videos/a.mp4",
      filename: "a.mp4",
      sizeBytes: 1,
      mtimeMs: 1,
      metadata: { durationUs: 4_000_000, width: 640, height: 360 },
    });
    resetDocument(insertClip(added.project, { assetId: added.assetId }).project);
    mount();
    const profile = container.querySelector('[role="combobox"][aria-label="Perfil de calidad"]');
    act(() => profile.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (el) => el.textContent.trim() === "Calidad",
    );
    act(() => option.click());
    await act(async () => buttonWithText("Exportar MP4").click());
    expect(api.exportEditorComposition).toHaveBeenCalledWith({
      manifest: expect.objectContaining({
        jobs: [expect.objectContaining({ encode_profile: "quality" })],
      }),
    });
  });

  it("cancels the frame render when a busy exact-frame view is closed", async () => {
    const added = addAsset(createEmptyEditorProject(), {
      path: "C:/Videos/a.mp4",
      filename: "a.mp4",
      sizeBytes: 1,
      mtimeMs: 1,
      metadata: { durationUs: 4_000_000, width: 640, height: 360 },
    });
    resetDocument(insertClip(added.project, { assetId: added.assetId }).project);
    mount();
    await act(async () => buttonWithText("Vista exacta").click());
    expect(api.renderEditorExactFrame).toHaveBeenCalledTimes(1);
    act(() => container.querySelector(".editor-exact-frame button").click());
    expect(api.cancelEditorExport).toHaveBeenCalledWith({ kind: "frame" });
  });

  it("saves a never-saved document through the save-as path on Ctrl+S", async () => {
    mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    });
    expect(api.saveEditorProject).toHaveBeenCalledTimes(1);
    expect(api.saveEditorProject.mock.calls[0][0].saveAs).toBe(true);
  });

  it("uses Ctrl+Z for undo inside the editor", () => {
    const base = createEmptyEditorProject();
    const edited = { ...base, canvas: { ...base.canvas, width: 800 } };
    useTimelineStore.setState({
      history: { present: edited, past: [base], future: [], gesture: null },
    });
    mount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    });
    expect(useTimelineStore.getState().history.present).toBe(base);
  });

  it("offers autosave recovery once per app session across dependency changes and remounts", async () => {
    const originalConfirm = useEditorStore.getState().requestConfirm;
    const confirm = vi.fn(async () => true);
    const recovered = createEmptyEditorProject();
    let finishRead;
    api.readEditorAutosave = vi.fn(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    api.clearEditorAutosave = vi.fn(async () => ({ success: true }));
    useEditorStore.setState({ requestConfirm: confirm });
    try {
      mount();
      expect(api.readEditorAutosave).toHaveBeenCalledTimes(1);
      act(() => useEditorStore.setState({ language: "en" }));
      await act(async () =>
        finishRead({ success: true, autosave: { savedAt: Date.now(), project: recovered } }),
      );

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0][0].title).toBe("Recuperar montaje");
      expect(useTimelineStore.getState().history.present).toBe(recovered);
      expect(api.clearEditorAutosave).not.toHaveBeenCalled();

      act(() => root.render(null));
      act(() => root.render(<EditorWorkspace />));
      expect(api.readEditorAutosave).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally {
      delete api.readEditorAutosave;
      delete api.clearEditorAutosave;
      act(() => useEditorStore.setState({ requestConfirm: originalConfirm, language: "es" }));
    }
  });
});
