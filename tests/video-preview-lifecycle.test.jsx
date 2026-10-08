import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import useVideoPreviewLifecycle from "../src/components/video-preview/useVideoPreviewLifecycle.js";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;

function Harness({ selection }) {
  const videoRef = useRef(null);
  const { currentTimeRef, videoError, videoHandlers } = useVideoPreviewLifecycle({
    videoRef,
    sel: selection,
    sidebarMode: "text",
  });
  return (
    <>
      <video ref={videoRef} {...videoHandlers} />
      <output data-testid="time">{currentTimeRef.current}</output>
      <output data-testid="error">{videoError}</output>
    </>
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("video preview selection lifecycle", () => {
  it("preserves the playhead, error and region on same-file edits, then resets on file change", () => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    const selection = { path: "C:/videos/first.mp4", duration: 10, operations: [] };
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    useEditorStore.setState({ queue: [selection], selectedIdx: 0, currentRegion: region });
    act(() => root.render(<Harness selection={selection} />));

    const video = document.querySelector("video");
    Object.defineProperty(video, "error", {
      configurable: true,
      value: { code: 3, message: "decode failed" },
    });
    act(() => {
      video.currentTime = 4;
      video.dispatchEvent(new Event("seeked"));
      video.dispatchEvent(new Event("error"));
    });
    expect(document.querySelector('[data-testid="time"]').textContent).toBe("4");
    expect(document.querySelector('[data-testid="error"]').textContent).toBe(
      "code 3: decode failed",
    );

    act(() => root.render(<Harness selection={{ ...selection, duration: 12, trimEnd: 8 }} />));
    expect(document.querySelector('[data-testid="time"]').textContent).toBe("4");
    expect(document.querySelector('[data-testid="error"]').textContent).toBe(
      "code 3: decode failed",
    );
    expect(useEditorStore.getState().currentRegion).toEqual(region);

    act(() => root.render(<Harness selection={{ ...selection, path: "C:/videos/second.mp4" }} />));
    expect(document.querySelector('[data-testid="time"]').textContent).toBe("0");
    expect(document.querySelector('[data-testid="error"]').textContent).toBe("");

    act(() => root.render(<Harness selection={null} />));
    expect(useEditorStore.getState().currentRegion).toBeNull();
  });
});
