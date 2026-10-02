import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useFilmstripFrames from "../src/components/video-preview/useFilmstripFrames.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Filmstrip({ path, count, duration = 10 }) {
  const { frames, aspect } = useFilmstripFrames(path, duration, count);
  return createElement(
    "div",
    { "data-aspect": aspect },
    frames.map((src, key) => src && createElement("img", { key, src, alt: "", "data-index": key })),
  );
}

const strip = (n) => ({
  frames: Array.from({ length: n }, (_, i) => `data:image/jpeg;base64,${btoa(`f-${i}`)}`),
  aspect: 1.5,
});

describe("filmstrip frames", () => {
  let root;
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    window.api = {
      getFilmstrip: vi.fn(async () => strip(3)),
      cancelFilmstrip: vi.fn(async () => true),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.api;
  });

  const images = () => Array.from(container.querySelectorAll("img"), (img) => img.src);
  const aspect = () => container.firstChild.dataset.aspect;
  const render = (path, count, duration) =>
    act(() => root.render(createElement(Filmstrip, { path, count, duration })));

  it("requests the strip once from the main pipeline and publishes it", async () => {
    const path = "C:/clips/filmstrip-basic.mp4";
    await render(path, 5);
    expect(window.api.getFilmstrip).toHaveBeenCalledTimes(1);
    expect(window.api.getFilmstrip).toHaveBeenCalledWith({
      path,
      duration: 10,
      count: 5,
      height: 64,
      requestId: expect.any(String),
    });
    expect(images()).toEqual(strip(3).frames);
    expect(aspect()).toBe("1.5");
  });

  it("revalidates a completed strip in main on reselect", async () => {
    const path = "C:/clips/filmstrip-cache.mp4";
    await render(path);
    const completed = images();
    await render(null);
    expect(images()).toEqual([]);
    await render(path);
    expect(images()).toEqual(completed);
    expect(window.api.getFilmstrip).toHaveBeenCalledTimes(2);
  });

  it("cancels a deselected request, ignores its late result and retries on reselect", async () => {
    const first = "C:/clips/filmstrip-late.mp4";
    let release;
    window.api.getFilmstrip.mockImplementation((payload) =>
      payload.path === first
        ? new Promise((resolve) => (release = resolve))
        : Promise.resolve(strip(2)),
    );
    await render(first, 2);
    const requestId = window.api.getFilmstrip.mock.calls[0][0].requestId;
    await render("C:/clips/filmstrip-selected.mp4", 2);
    expect(window.api.cancelFilmstrip).toHaveBeenCalledWith(requestId);
    expect(images()).toEqual(strip(2).frames);

    await act(async () => release(strip(4)));
    expect(images()).toEqual(strip(2).frames);

    await render(first, 2);
    expect(images()).toEqual([]);
    expect(window.api.getFilmstrip.mock.calls.filter(([p]) => p.path === first)).toHaveLength(2);
  });

  it("leaves the strip empty when the pipeline returns nothing and retries on reselect", async () => {
    window.api.getFilmstrip.mockResolvedValue(null);
    const path = "C:/clips/filmstrip-empty.mp4";
    await render(path);
    expect(images()).toEqual([]);
    await render("C:/clips/filmstrip-other.mp4");
    await render(path);
    const emptyCalls = window.api.getFilmstrip.mock.calls.filter(([p]) => p.path === path);
    expect(emptyCalls).toHaveLength(2);
  });

  it("does not request a strip without a usable path or duration", async () => {
    function NoDuration({ path }) {
      useFilmstripFrames(path, 0);
      return null;
    }
    await render(null);
    await act(() => root.render(createElement(NoDuration, { path: "C:/clips/x.mp4" })));
    expect(window.api.getFilmstrip).not.toHaveBeenCalled();
  });

  it("publishes indexed progress before completion and rejects stale request events", async () => {
    let progress;
    let finish;
    const unsubscribe = vi.fn();
    window.api.onFilmstripProgress = vi.fn((listener) => {
      progress = listener;
      return unsubscribe;
    });
    window.api.getFilmstrip.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render("C:/clips/progressive.mp4", 4);
    const requestId = window.api.getFilmstrip.mock.calls[0][0].requestId;
    await act(() => {
      progress({ requestId, index: 3, count: 4, frame: strip(4).frames[3], aspect: 1.5 });
      progress({ requestId, index: 0, count: 4, frame: strip(4).frames[0], aspect: 1.5 });
      progress({ requestId: "old", index: 1, count: 4, frame: "stale" });
    });
    expect(images()).toEqual([strip(4).frames[0], strip(4).frames[3]]);
    expect([...container.querySelectorAll("img")].map((img) => img.dataset.index)).toEqual([
      "0",
      "3",
    ]);
    await act(async () => finish(strip(4)));
    expect(images()).toEqual(strip(4).frames);
    expect(unsubscribe).toHaveBeenCalled();
    await render(null);
    expect(window.api.cancelFilmstrip).not.toHaveBeenCalled();
    await act(() => progress({ requestId, index: 0, count: 4, frame: "late" }));
    expect(images()).toEqual([]);
  });

  it("requests new samples when duration or count changes at the same path", async () => {
    await render("C:/clips/options.mp4", 5, 10);
    await render("C:/clips/options.mp4", 5, 20);
    await render("C:/clips/options.mp4", 8, 20);
    expect(window.api.getFilmstrip.mock.calls.map(([p]) => [p.duration, p.count])).toEqual([
      [10, 5],
      [20, 5],
      [20, 8],
    ]);
  });
});
