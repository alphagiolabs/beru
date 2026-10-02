import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogoTimeline from "../src/components/video-preview/LogoTimeline.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { buildExportJob } from "../src/utils/export-pipeline.js";
import { buildSessionSnapshot, parseSessionSnapshot } from "../src/utils/session-persist.js";
import { createQueueItem } from "../src/utils/types.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const item = () =>
  createQueueItem({
    path: "C:\\videos\\clip.mp4",
    filename: "clip.mp4",
    width: 64,
    height: 64,
    duration: 10,
  });

function TimelineHarness() {
  const sel = useEditorStore((s) => s.queue[0]);
  return createElement(LogoTimeline, {
    sel,
    videoIdx: 0,
    currentTime: 0,
    duration: 10,
    trimStart: sel.trimStart ?? 0,
    trimEnd: sel.trimEnd ?? 10,
    playing: false,
    muted: false,
    canUndo: false,
    canRedo: false,
    selectedOperationIdx: null,
    renderLoading: false,
    renderActive: false,
    onTogglePlay() {},
    onJumpStart() {},
    onJumpEnd() {},
    onToggleMute() {},
    onToggleRender() {},
    onScrubStart() {},
    onScrub() {},
    onScrubEnd() {},
  });
}

describe("logo timeline video trim", () => {
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    useEditorStore.setState({
      queue: [item()],
      selectedIdx: 0,
      isProcessing: false,
      language: "es",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
    delete window.api;
  });

  it("fills the timeline from available samples without shifting failed temporal slots", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(292);
    const frames = [
      "data:image/jpeg;base64,Zmlyc3Q=",
      null,
      null,
      "data:image/jpeg;base64,bGFzdA==",
    ];
    window.api = { getFilmstrip: vi.fn(async () => ({ frames, aspect: 1.5 })) };
    await act(async () => root.render(createElement(TimelineHarness)));
    const tiles = [...document.querySelectorAll(".logo-tl-film img")];
    expect(tiles.map((img) => img.src)).toEqual([frames[0], frames[0], frames[3], frames[3]]);
  });

  it("moves both trim handles with the keyboard and resets the selection", () => {
    act(() => root.render(createElement(TimelineHarness)));
    const start = document.querySelector(".logo-tl-trim-handle--start");
    const end = document.querySelector(".logo-tl-trim-handle--end");
    expect(start.getAttribute("aria-valuenow")).toBe("0");
    expect(end.getAttribute("aria-valuenow")).toBe("10");

    act(() =>
      start.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    act(() => end.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(useEditorStore.getState().queue[0]).toEqual(
      expect.objectContaining({ trimStart: 0.1, trimEnd: 9.9 }),
    );
    expect(document.querySelector(".logo-tl-trim-info").textContent).toContain("00:00.10");

    act(() => document.querySelector(".logo-tl-trim-info button").click());
    expect(useEditorStore.getState().queue[0]).toEqual(
      expect.objectContaining({ trimStart: null, trimEnd: null }),
    );
  });

  it("sends the selected interval to export and restores it with the session", () => {
    useEditorStore.getState().setVideoTrim(0, 1.25, 7.5, 10);
    const selected = useEditorStore.getState().queue[0];
    const job = buildExportJob(selected, 0, { outputPath: "C:\\out\\clip.mp4" });
    expect(job).toEqual(expect.objectContaining({ trim_start: 1.25, trim_end: 7.5 }));
    expect(job.video_duration).toBe(10);

    const restored = parseSessionSnapshot(buildSessionSnapshot({ queue: [selected] }));
    expect(restored.queue[0]).toEqual(expect.objectContaining({ trimStart: 1.25, trimEnd: 7.5 }));

    const fullJob = buildExportJob(item(), 0, { outputPath: "C:\\out\\full.mp4" });
    expect(fullJob).toEqual(expect.objectContaining({ trim_start: 0, trim_end: null }));
  });

  it("drags the clip handles to select the exported interval", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(214);
    const setVideoTrim = vi.spyOn(useEditorStore.getState(), "setVideoTrim");
    act(() => root.render(createElement(TimelineHarness)));
    expect(document.querySelector(".logo-tl-content").style.width).toBe("214px");
    document.querySelector(".logo-tl-scroll").scrollLeft = 0;
    const start = document.querySelector(".logo-tl-trim-handle--start");
    const end = document.querySelector(".logo-tl-trim-handle--end");
    act(() =>
      start.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 14 })),
    );
    act(() => start.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 51.2 })));
    expect(setVideoTrim).toHaveBeenCalledWith(0, 2, 10, 10);
    expect(useEditorStore.getState().queue[0]).toEqual(
      expect.objectContaining({ trimStart: 2, trimEnd: null }),
    );
    act(() => start.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    act(() =>
      end.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200 })),
    );
    act(() => end.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 144.2 })));
    act(() => end.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    const job = buildExportJob(useEditorStore.getState().queue[0], 0, {
      outputPath: "C:\\out\\clip.mp4",
    });
    expect(job).toEqual(expect.objectContaining({ trim_start: 2, trim_end: 7 }));
  });
});
