import React, { act } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import DateTimeOverlay from "../src/components/video-preview/DateTimeOverlay.jsx";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;
let video = null;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  video = document.createElement("video");
  Object.defineProperty(video, "currentTime", { value: 0, writable: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const texts = () =>
  [...document.querySelectorAll("[data-display-text]")].map((node) => node.dataset.displayText);

function renderAt(op) {
  root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(
      <DateTimeOverlay
        videoRef={{ current: video }}
        screen={{ x: 0, y: 0, w: 600, h: 60, sx: 1, sy: 1 }}
        op={{ fontSize: 28, safeMargin: 4, bgEnabled: true, boxBorderWidth: 6, ...op }}
        fallbackText="DD/MM/AAAA hh:mm:ss"
      />,
    );
  });
}

it("shows the clock for the source second under the playhead and follows seeks", () => {
  video.currentTime = 7.5;
  renderAt({ clockStart: "2026-10-06T12:04:13", clockLayout: "split" });
  expect(texts()).toEqual(["06/10/2026", "12:04:20"]);

  video.currentTime = 70.2;
  act(() => video.dispatchEvent(new Event("seeked")));
  expect(texts()).toEqual(["06/10/2026", "12:05:23"]);
});

it("draws one box per block side by side and a hint without a valid start", () => {
  renderAt({ clockStart: "2026-10-06T12:04:13", clockLayout: "split" });
  const boxes = [
    ...document.querySelectorAll('[data-datetime-overlay] [data-text-overlay="true"]'),
  ];
  expect(boxes).toHaveLength(2);
  expect(parseFloat(boxes[1].style.left)).toBeGreaterThan(parseFloat(boxes[0].style.width));

  act(() => root.unmount());
  renderAt({ clockStart: "" });
  expect(texts()).toEqual(["DD/MM/AAAA hh:mm:ss"]);
});

it("defaults to one box and stretches the text like the export layer", () => {
  renderAt({ clockStart: "2026-10-06T12:04:13", textScaleX: 2, safeMargin: 0, boxBorderWidth: 0 });
  expect(texts()).toEqual(["06/10/2026 12:04:13"]);
  const run = document.querySelector("[data-export-layout]");
  expect(run.style.transform).toBe("scaleX(2)");
  expect(run.style.width).toBe("50%");
});
