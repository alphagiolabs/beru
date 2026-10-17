import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useRegionGesture from "../src/hooks/useRegionGesture.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const region = { x: 0.2, y: 0.2, w: 0.3, h: 0.2 };
let gesture, root, frames, onChange, onCommit;
const video = {
  videoWidth: 640,
  videoHeight: 360,
  paused: true,
  getBoundingClientRect: () => ({ width: 1280, height: 720 }),
};

function View({ owner = "a", input = "pointer", enabled = true }) {
  gesture = useRegionGesture({
    videoEl: { current: video },
    onChange,
    onCommit,
    owner,
    input,
    enabled,
  });
  return null;
}

function begin(handle) {
  const event = {
    button: 0,
    clientX: 100,
    clientY: 100,
    preventDefault() {},
    stopPropagation() {},
  };
  act(() => {
    if (handle) gesture.beginResize(event, region, handle);
    else gesture.beginMove(event, region);
  });
}

function move(clientX, input = "pointer") {
  act(() => window.dispatchEvent(new MouseEvent(`${input}move`, { clientX, clientY: 100 })));
}

beforeEach(() => {
  onChange = vi.fn();
  onCommit = vi.fn();
  frames = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (fn) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key) => frames.delete(key));
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(View)));
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("region gesture lifecycle", () => {
  it.each(["pointer", "mouse"])(
    "coalesces %s moves and flushes the final region before commit",
    (input) => {
      act(() => root.render(createElement(View, { input })));
      begin();
      move(164, input);
      move(228, input);
      expect(frames.size).toBe(1);
      expect(onChange).not.toHaveBeenCalled();
      act(() => window.dispatchEvent(new MouseEvent(`${input}up`)));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toEqual({ ...region, x: expect.closeTo(0.3) });
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(onChange.mock.calls[0][0]);
      expect(frames.size).toBe(0);
      expect(gesture.active).toBe(false);
    },
  );

  it("does not publish or commit a zero delta", () => {
    begin();
    move(100);
    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(frames.size).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not schedule repeated movement clamped to the same edge", () => {
    begin();
    move(5000);
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    act(() => callback());
    move(6000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it("returns to the original region when the pointer returns to its start", () => {
    begin();
    move(228);
    move(100);
    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(region);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(region);
  });

  it("resizes using the same visual content size as movement", () => {
    begin("mr");
    move(228);
    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(onCommit).toHaveBeenCalledWith({ ...region, w: 0.4 });
  });

  it.each([{ owner: "b" }, { enabled: false }])(
    "drops a queued update after its owner is invalidated: %j",
    (props) => {
      begin();
      move(228);
      act(() => root.render(createElement(View, props)));
      expect(frames.size).toBe(0);
      act(() => window.dispatchEvent(new MouseEvent("pointerup")));
      expect(onChange).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
      expect(gesture.active).toBe(false);
    },
  );

  it("cancels a queued frame when the component unmounts", () => {
    begin();
    move(228);
    act(() => root.render(null));
    expect(frames.size).toBe(0);
    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
