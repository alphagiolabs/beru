import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import ExternalAudioControls from "../src/components/ExternalAudioControls.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
beforeEach(() => {
  useEditorStore.setState({
    queue: ["a", "b"].map((name) =>
      createQueueItem({
        path: `C:\\media\\${name}.mp4`,
        filename: `${name}.mp4`,
        width: 320,
        height: 180,
        duration: 4,
      }),
    ),
    selectedIdx: 0,
    isProcessing: false,
    undoStack: [],
    redoStack: [],
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  act(() => root.render(<ExternalAudioControls />));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  window.api = {};
});

it("selects, listens and removes an asset without touching the file", async () => {
  window.api = {
    pickAudio: vi.fn().mockResolvedValue({
      success: true,
      path: "C:\\media\\music.wav",
      name: "music.wav",
      duration: 3,
      version: "v1",
    }),
  };
  await act(async () => document.querySelector("button").click());
  expect(document.body.textContent).toContain("music.wav");
  expect(document.querySelector("audio").getAttribute("src")).toContain("?v=v1");
  expect(useEditorStore.getState().queue[0].externalAudio.path).toBe("C:\\media\\music.wav");
  act(() => document.querySelector('button[aria-label="Quitar audio añadido"]').click());
  expect(document.querySelector("audio")).toBeNull();
  act(() => useEditorStore.getState().undo());
  expect(document.body.textContent).toContain("music.wav");
});

it("discards selection results after changing clip and reports invalid files", async () => {
  let resolve;
  window.api = {
    pickAudio: vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ),
  };
  act(() => document.querySelector("button").click());
  act(() => useEditorStore.getState().selectVideo(1));
  await act(async () => resolve({ success: true, path: "C:\\media\\music.wav", duration: 3 }));
  expect(useEditorStore.getState().queue.map((item) => item.externalAudio)).toEqual([null, null]);
  window.api.pickAudio.mockResolvedValue({ success: false, error: "Audio inválido" });
  await act(async () => document.querySelector("button").click());
  expect(document.querySelector('[role="alert"]').textContent).toBe("Audio inválido");
});
