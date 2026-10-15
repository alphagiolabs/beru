import React, { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { useMontagePlayer } from "../src/features/editor/playback/useMontagePlayer.js";
import { appendClipFromAsset, setClipRange } from "../src/features/editor/editor-model.js";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, layoutTrack } from "../shared/editor-timeline.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SECOND = 1_000_000;

beforeAll(() => {
  const proto = HTMLMediaElement.prototype;
  Object.defineProperty(proto, "paused", {
    configurable: true,
    get() {
      return this.__paused ?? true;
    },
  });
  Object.defineProperty(proto, "currentTime", {
    configurable: true,
    get() {
      return this.__time ?? 0;
    },
    set(value) {
      this.__time = value;
    },
  });
  Object.defineProperty(proto, "readyState", {
    configurable: true,
    get() {
      return this.__ready ?? 0;
    },
  });
  Object.defineProperty(proto, "seeking", {
    configurable: true,
    get() {
      return false;
    },
  });
  // videoWidth is defined by jsdom on HTMLVideoElement, which shadows the media prototype.
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get() {
      return 320;
    },
  });
  proto.play = function play() {
    this.__paused = false;
    return Promise.resolve();
  };
  proto.pause = function pause() {
    this.__paused = true;
  };
});

let frames = [];
vi.stubGlobal("requestAnimationFrame", (callback) => {
  frames.push(callback);
  return frames.length;
});
vi.stubGlobal("cancelAnimationFrame", vi.fn());

function runFrame() {
  const queued = frames;
  frames = [];
  act(() => queued.forEach((callback) => callback(0)));
}

function load(element) {
  element.__ready = 4;
  element.dispatchEvent(new Event("loadedmetadata"));
  element.dispatchEvent(new Event("loadeddata"));
}

function settle(element) {
  element.__ready = 4;
  element.dispatchEvent(new Event("seeked"));
}

function Harness(props) {
  const { refs, active, status } = useMontagePlayer(props);
  return (
    <div>
      <video ref={refs[0]} data-slot="0" />
      <video ref={refs[1]} data-slot="1" />
      <span data-testid="active">{active}</span>
      <span data-testid="status">{status}</span>
    </div>
  );
}

function twoClipMontage() {
  let project = createEmptyEditorProject();
  const a = addAsset(project, {
    path: "C:/a.mp4",
    filename: "a.mp4",
    metadata: { durationUs: 10 * SECOND },
  });
  project = appendClipFromAsset(a.project, a.assetId);
  const b = addAsset(project, {
    path: "C:/b.mp4",
    filename: "b.mp4",
    metadata: { durationUs: 8 * SECOND },
  });
  project = appendClipFromAsset(b.project, b.assetId);
  const [first, second] = layoutTrack(project);
  project = setClipRange(project, first.clip.id, 1, 6);
  project = setClipRange(project, second.clip.id, 0, 4);
  return { layout: layoutTrack(project), a: a.assetId, b: b.assetId };
}

describe("montage player", () => {
  let container;
  let root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    frames = [];
  });

  function mount(props, strict = false) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let current = props;
    const render = () =>
      root.render(
        strict ? (
          <React.StrictMode>
            <Harness {...current} />
          </React.StrictMode>
        ) : (
          <Harness {...current} />
        ),
      );
    act(render);
    return {
      el: [container.querySelector('[data-slot="0"]'), container.querySelector('[data-slot="1"]')],
      active: () => Number(container.querySelector('[data-testid="active"]').textContent),
      status: () => container.querySelector('[data-testid="status"]').textContent,
      rerender: (next) => {
        current = { ...current, ...next };
        act(render);
      },
    };
  }

  it("prepares the first clip paused at its in point, then plays through the handover to the next clip", () => {
    const { layout, a, b } = twoClipMontage();
    const onPlayhead = vi.fn();
    const onPlayingChange = vi.fn();
    const props = {
      layout,
      sourceUrlFor: (assetId) => `https://media.test/${assetId}.mp4`,
      playing: false,
      playhead: 0,
      onPlayhead,
      onPlayingChange,
    };
    const view = mount(props);
    const [first, second] = view.el;

    expect(first.src).toBe(`https://media.test/${a}.mp4`);
    load(first);
    expect(first.currentTime).toBe(1);
    expect(first.paused).toBe(true);

    view.rerender({ playing: true });
    settle(first);
    expect(first.paused).toBe(false);

    first.currentTime = 5;
    runFrame();
    expect(onPlayhead).toHaveBeenLastCalledWith(4 * SECOND);
    expect(second.src).toBe(`https://media.test/${b}.mp4`);
    load(second);

    first.currentTime = 6;
    runFrame();
    expect(view.active()).toBe(1);
    expect(first.paused).toBe(true);
    expect(second.paused).toBe(false);

    second.currentTime = 4;
    runFrame();
    expect(onPlayhead).toHaveBeenLastCalledWith(9 * SECOND);
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    expect(second.paused).toBe(true);
  });

  it("seeks while paused by loading the clip under the playhead into the active element", () => {
    const { layout, b } = twoClipMontage();
    const view = mount({
      layout,
      sourceUrlFor: (assetId) => `https://media.test/${assetId}.mp4`,
      playing: false,
      playhead: 0,
      onPlayhead: vi.fn(),
      onPlayingChange: vi.fn(),
    });
    const [first] = view.el;
    load(first);
    view.rerender({ playhead: 6 * SECOND });
    expect(first.src).toBe(`https://media.test/${b}.mp4`);
    load(first);
    expect(first.currentTime).toBe(1);
  });

  it("reports a missing source instead of loading it", () => {
    const { layout } = twoClipMontage();
    const view = mount({
      layout,
      sourceUrlFor: () => null,
      playing: false,
      playhead: 0,
      onPlayhead: vi.fn(),
      onPlayingChange: vi.fn(),
    });
    expect(view.status()).toBe("missing");
    expect(view.el[0].hasAttribute("src")).toBe(false);
  });

  it("stops a running playback when the montage changes under it", () => {
    const { layout } = twoClipMontage();
    const onPlayingChange = vi.fn();
    const view = mount({
      layout,
      sourceUrlFor: (assetId) => `https://media.test/${assetId}.mp4`,
      playing: false,
      playhead: 0,
      onPlayhead: vi.fn(),
      onPlayingChange,
    });
    load(view.el[0]);
    view.rerender({ playing: true });
    settle(view.el[0]);
    const edited = [...layout].reverse();
    view.rerender({ layout: edited });
    expect(onPlayingChange).toHaveBeenCalledWith(false);
  });

  it("moves a clip already on an element to its proxy when the source resolver changes", () => {
    const { layout, a } = twoClipMontage();
    let proxies = {};
    const resolver = (assetId) => proxies[assetId] ?? `https://media.test/${assetId}.mp4`;
    const view = mount({
      layout,
      sourceUrlFor: resolver,
      playing: false,
      playhead: 0,
      onPlayhead: vi.fn(),
      onPlayingChange: vi.fn(),
    });
    const [first] = view.el;
    expect(first.src).toBe(`https://media.test/${a}.mp4`);
    proxies = { [a]: `https://media.test/${a}-proxy.mp4` };
    view.rerender({ sourceUrlFor: (assetId) => resolver(assetId) });
    expect(first.src).toBe(`https://media.test/${a}-proxy.mp4`);
    act(() => {
      load(first);
      settle(first);
    });
    expect(view.status()).toBe("ready");
  });

  it("keeps a clip without a decodable video track in the no-video state when its data loads", () => {
    const { layout } = twoClipMontage();
    const view = mount({
      layout,
      sourceUrlFor: (assetId) => `https://media.test/${assetId}.mp4`,
      playing: false,
      playhead: 0,
      onPlayhead: vi.fn(),
      onPlayingChange: vi.fn(),
    });
    const [first] = view.el;
    Object.defineProperty(first, "videoWidth", { configurable: true, get: () => 0 });
    act(() => {
      first.__ready = 4;
      first.dispatchEvent(new Event("loadedmetadata"));
      first.dispatchEvent(new Event("loadeddata"));
    });
    expect(view.status()).toBe("noVideo");
  });

  it.each([false, true])(
    "keeps playback continuous and reads current callbacks across rerenders (StrictMode=%s)",
    (strict) => {
      const { layout } = twoClipMontage();
      const originalPlayhead = vi.fn();
      const currentPlayhead = vi.fn();
      const view = mount(
        {
          layout,
          sourceUrlFor: (assetId) => `https://media.test/${assetId}.mp4`,
          playing: false,
          playhead: 0,
          onPlayhead: originalPlayhead,
          onPlayingChange: vi.fn(),
        },
        strict,
      );
      const [first] = view.el;
      act(() => load(first));
      view.rerender({ playing: true });
      act(() => settle(first));
      first.currentTime = 2.5;
      const assignedSource = first.src;
      const removeListener = vi.spyOn(first, "removeEventListener");
      globalThis.cancelAnimationFrame.mockClear();

      view.rerender({ playhead: 1.5 * SECOND, onPlayhead: currentPlayhead });

      expect(first.currentTime).toBe(2.5);
      expect(first.src).toBe(assignedSource);
      expect(first.paused).toBe(false);
      expect(frames).toHaveLength(1);
      expect(globalThis.cancelAnimationFrame).not.toHaveBeenCalled();
      expect(removeListener).not.toHaveBeenCalled();
      runFrame();
      expect(currentPlayhead).toHaveBeenLastCalledWith(1.5 * SECOND);
      expect(originalPlayhead).not.toHaveBeenCalled();
    },
  );

  it("updates layer geometry during playback without seeking or replacing the frame loop", () => {
    const { layout } = twoClipMontage();
    const frameRefs = [
      { current: document.createElement("div") },
      { current: document.createElement("div") },
    ];
    const layer = {
      frame: { left: 10, top: 20, width: 160, height: 90 },
      source: { width: 320, height: 180 },
      matrix: [0.5, 0, 0, 0.5, 0, 0],
    };
    const view = mount({
      layout,
      sourceUrlFor: (assetId) => `https://media.test/${assetId}.mp4`,
      layerFor: () => layer,
      frames: frameRefs,
      playing: false,
      playhead: 0,
      onPlayhead: vi.fn(),
      onPlayingChange: vi.fn(),
    });
    const [first] = view.el;
    act(() => load(first));
    view.rerender({ playing: true });
    act(() => settle(first));
    first.currentTime = 3;

    view.rerender({ layerFor: () => ({ ...layer, frame: { ...layer.frame, left: 40 } }) });

    expect(frameRefs[0].current.style.left).toBe("40px");
    expect(first.style.transform).toBe("matrix(0.5, 0, 0, 0.5, 0, 0)");
    expect(first.currentTime).toBe(3);
    expect(first.paused).toBe(false);
    expect(frames).toHaveLength(1);
  });

  it("removes its media listeners from the captured elements when unmounted", () => {
    const { layout } = twoClipMontage();
    const onSeekTimed = vi.fn();
    const view = mount({
      layout,
      sourceUrlFor: (assetId) => `https://media.test/${assetId}.mp4`,
      playing: false,
      playhead: 0,
      onPlayhead: vi.fn(),
      onPlayingChange: vi.fn(),
      onSeekTimed,
    });
    const removals = view.el.map((element) => vi.spyOn(element, "removeEventListener"));

    act(() => root.render(null));

    for (const removal of removals)
      expect(removal.mock.calls.map(([type]) => type).sort()).toEqual([
        "error",
        "loadeddata",
        "loadedmetadata",
        "seeked",
      ]);
    view.el[0].dispatchEvent(new Event("seeked"));
    expect(onSeekTimed).not.toHaveBeenCalled();
  });
});
