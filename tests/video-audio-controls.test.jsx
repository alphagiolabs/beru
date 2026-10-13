import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import VideoAudioControls from "../src/components/VideoAudioControls.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";
import { buildSessionSnapshot, parseSessionSnapshot } from "../src/utils/session-persist.js";
import { buildExportJob } from "../src/utils/export-pipeline.js";
import { normalizeJob } from "../shared/job-manifest.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const item = (name, extra = {}) =>
  createQueueItem({
    path: `C:\\media\\${name}.mp4`,
    filename: `${name}.mp4`,
    width: 320,
    height: 180,
    duration: 4,
    audioCodec: "aac",
    audioChannels: 2,
    ...extra,
  });
const slider = () => document.querySelector('input[type="range"]');
const changeVolume = (value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider(), value);
    slider().dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("exportable original audio", () => {
  let root;
  beforeEach(() => {
    useEditorStore.setState({
      queue: [item("a"), item("b")],
      selectedIdx: 0,
      isProcessing: false,
      undoStack: [],
      redoStack: [],
    });
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    act(() => root.render(<VideoAudioControls />));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("groups a slider gesture but starts a new step after undo", () => {
    changeVolume(75);
    changeVolume(50);
    act(() => useEditorStore.getState().undo());
    expect(slider().value).toBe("100");
    changeVolume(25);
    act(() => useEditorStore.getState().undo());
    expect(slider().value).toBe("100");
    act(() => useEditorStore.getState().redo());
    expect(slider().value).toBe("25");
  });

  it("keeps changes on two selected clips independently undoable", () => {
    changeVolume(50);
    act(() => useEditorStore.getState().selectVideo(1));
    changeVolume(25);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().queue.map((q) => q.audio.gain)).toEqual([0.5, 1]);
  });

  it("persists gain and mute and emits them through the real Job builder", () => {
    changeVolume(50);
    act(() => document.querySelector('button[aria-label="Silenciar audio original"]').click());
    const state = useEditorStore.getState();
    const restored = parseSessionSnapshot(buildSessionSnapshot(state));
    expect(restored.queue[0].audio).toEqual({ gain: 0.5, muted: true });
    const job = buildExportJob(restored.queue[0], 0, { outputPath: "C:\\out\\a.mp4" });
    expect(job.audio_gain).toBe(0.5);
    expect(job.audio_muted).toBe(true);
    expect(restored.queue[1].audio).toEqual({ gain: 1, muted: false });
  });

  it("blocks audio edits during processing and hides them for silent sources", () => {
    act(() => useEditorStore.setState({ isProcessing: true }));
    expect(slider().disabled).toBe(true);
    act(() => useEditorStore.getState().setVideoAudio({ gain: 0.5 }));
    expect(useEditorStore.getState().queue[0].audio.gain).toBe(1);
    act(() =>
      useEditorStore.setState({
        isProcessing: false,
        queue: [item("silent", { audioCodec: "", audioChannels: 0 })],
      }),
    );
    expect(slider()).toBeNull();
    expect(document.body.textContent).toContain("no tiene pista de audio");
  });

  it("restores legacy and invalid audio settings as identity", () => {
    const restored = parseSessionSnapshot({
      version: 1,
      queue: [
        item("legacy", { audio: undefined }),
        item("null", { audio: { gain: null } }),
        item("blank", { audio: { gain: "" } }),
        item("whitespace", { audio: { gain: " " } }),
      ],
    });
    expect(restored.queue.map((q) => q.audio)).toEqual([
      { gain: 1, muted: false },
      { gain: 1, muted: false },
      { gain: 1, muted: false },
      { gain: 1, muted: false },
    ]);
    expect(normalizeJob({ audio_gain: " " }).audio_gain).toBe(1);
  });
});
