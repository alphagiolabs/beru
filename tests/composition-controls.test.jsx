import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CompositionModal from "../src/components/CompositionModal.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
const button = (text) =>
  [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === text);
beforeEach(() => {
  useEditorStore.setState({
    language: "es",
    queue: ["a", "b"].map((name) =>
      createQueueItem({
        path: `C:/m/${name}.mp4`,
        filename: `${name}.mp4`,
        width: 320,
        height: 180,
        duration: 4,
      }),
    ),
    selectedIdx: 0,
    composition: null,
    showCompositionModal: true,
    isProcessing: false,
    outputDir: "C:/out",
    mediaExport: null,
  });
  window.api = {
    saveComposition: vi.fn(async () => ({ success: true })),
    loadComposition: vi.fn(),
    startComposition: vi.fn(async () => ({ success: true, runId: "compose-1" })),
  };
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  act(() => root.render(<CompositionModal />));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});
it("selects sources without changing the editor, edits/reorders snapshots and saves a separate document", async () => {
  const queue = useEditorStore.getState().queue;
  act(() => button("Añadir video seleccionado").click());
  act(() =>
    document
      .querySelector('[aria-label="Video de la cola para añadir"]')
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  act(() =>
    [...document.querySelectorAll('[role="option"]')]
      .find((el) => el.textContent === "b.mp4")
      .click(),
  );
  act(() => button("Añadir video seleccionado").click());
  act(() => document.querySelector('[aria-label="Subir b.mp4"]').click());
  const start = document.querySelector('[aria-label="Recorte desde fuente (s)"]');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(start, "1");
    start.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(useEditorStore.getState().composition.entries.map((entry) => entry.item.filename)).toEqual(
    ["b.mp4", "a.mp4"],
  );
  expect(useEditorStore.getState().composition.entries[0].item.trimStart).toBe(1);
  expect(useEditorStore.getState().selectedIdx).toBe(0);
  expect(useEditorStore.getState().queue).toBe(queue);
  await act(async () => button("Guardar composición").click());
  expect(window.api.saveComposition).toHaveBeenCalledWith(
    expect.objectContaining({ type: "beru-composition", version: 1 }),
    expect.anything(),
  );
  await act(async () => button("Exportar composición").click());
  expect(window.api.startComposition).toHaveBeenCalledWith(
    expect.objectContaining({ jobs: [expect.objectContaining({ kind: "composition", id: -1 })] }),
  );
  expect(useEditorStore.getState().queue).toBe(queue);
});

it("discards an edited frame that finishes after closing and reopening the composition", async () => {
  act(() => useEditorStore.getState().addCompositionEntry(0));
  act(() => useEditorStore.getState().addCompositionEntry(1));
  let finish;
  window.api.renderPreviewFrame = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => button("Ver frame editado").click());
  act(() => useEditorStore.getState().setShowCompositionModal(false));
  await act(async () => finish({ ok: true, data_url: "data:image/png;base64,OLD" }));
  act(() => useEditorStore.getState().setShowCompositionModal(true));
  expect(document.querySelector('img[alt="Frame de la edición capturada"]')).toBeNull();
});

it("applies a loaded document once and rejects a load that finishes after its owner changes", async () => {
  act(() => useEditorStore.getState().addCompositionEntry(0));
  const original = useEditorStore.getState().composition,
    loaded = { ...original, outputName: "loaded" };
  window.api.loadComposition.mockResolvedValue({
    success: true,
    document: loaded,
  });
  await act(async () => button("Abrir composición").click());
  expect(useEditorStore.getState().composition.outputName).toBe("loaded");
  expect(window.api.loadComposition).toHaveBeenCalledTimes(1);
  let finish;
  window.api.loadComposition.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => button("Abrir composición").click());
  act(() => useEditorStore.getState().setCompositionSettings({ outputName: "edited" }));
  await act(async () => finish({ success: true, document: loaded }));
  expect(window.api.loadComposition).toHaveBeenCalledTimes(2);
  expect(useEditorStore.getState().composition.outputName).toBe("edited");
});

it("clears the edited frame when selecting another entry in the same document", async () => {
  act(() => {
    useEditorStore.getState().addCompositionEntry(0);
    useEditorStore.getState().addCompositionEntry(1);
  });
  window.api.renderPreviewFrame = vi.fn(async () => ({
    ok: true,
    data_url: "data:image/png;base64,FRAME",
  }));
  await act(async () => button("Ver frame editado").click());
  expect(document.querySelector('img[alt="Frame de la edición capturada"]')).not.toBeNull();
  const owner = useEditorStore.getState().composition;
  act(() => button("2. b.mp4").click());
  expect(useEditorStore.getState().composition).toBe(owner);
  expect(document.querySelector('img[alt="Frame de la edición capturada"]')).toBeNull();
  expect(document.querySelector('[role="dialog"] video').src).toContain(
    encodeURIComponent("C:/m/b.mp4"),
  );
});

it("discards a pending frame after seeking and can render the new timestamp", async () => {
  act(() => useEditorStore.getState().addCompositionEntry(0));
  const video = document.querySelector('[role="dialog"] video');
  video.currentTime = 1;
  let finish;
  window.api.renderPreviewFrame = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => button("Ver frame editado").click());
  expect(window.api.renderPreviewFrame).toHaveBeenLastCalledWith(
    expect.objectContaining({ timestamp: 1 }),
  );
  act(() => {
    video.currentTime = 3;
    video.dispatchEvent(new Event("seeked"));
  });
  await act(async () => finish({ ok: true, data_url: "data:image/png;base64,OLD" }));
  expect(document.querySelector('img[alt="Frame de la edición capturada"]')).toBeNull();
  expect(button("Ver frame editado").disabled).toBe(false);
  window.api.renderPreviewFrame.mockResolvedValue({
    ok: true,
    data_url: "data:image/png;base64,NEW",
  });
  await act(async () => button("Ver frame editado").click());
  expect(window.api.renderPreviewFrame).toHaveBeenLastCalledWith(
    expect.objectContaining({ timestamp: 3 }),
  );
  expect(document.querySelector('img[alt="Frame de la edición capturada"]').src).toBe(
    "data:image/png;base64,NEW",
  );
});
