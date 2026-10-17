import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useOperationDrag from "../src/components/video-preview/useOperationDrag.js";
import useEditorStore from "../src/stores/useEditorStore.js";
import { parseSessionSnapshot } from "../src/utils/session-persist.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const region = { x: 0.2, y: 0.2, w: 0.3, h: 0.2 };
const videoRef = {
  current: {
    videoWidth: 640,
    videoHeight: 360,
    offsetWidth: 640,
    offsetHeight: 360,
    paused: true,
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
  },
};
const event = () => ({
  button: 0,
  clientX: 100,
  clientY: 100,
  preventDefault() {},
  stopPropagation() {},
});
let root, drag, frames;

function View() {
  const state = useEditorStore();
  drag = useOperationDrag({ ...state, videoRef, sel: state.queue[state.selectedIdx] });
  return null;
}

const operation = () => useEditorStore.getState().queue[0].operations[0];
const move = (clientX) =>
  act(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY: 100 })));
const end = () => act(() => window.dispatchEvent(new MouseEvent("mouseup")));
function setOperation(mode, transform) {
  act(() =>
    useEditorStore.setState({
      queue: [
        {
          ...useEditorStore.getState().queue[0],
          transform,
          operations: [{ id: "op", mode, region: { ...region }, batchRegionId: "slot" }],
        },
      ],
    }),
  );
}

beforeEach(() => {
  videoRef.current.paused = true;
  videoRef.current.pause = vi.fn();
  frames = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (fn) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key) => frames.delete(key));
  useEditorStore.setState({
    queue: [{ path: "a.mp4", width: 640, height: 360, duration: 10, operations: [] }],
    selectedIdx: 0,
    selectedOperationIdx: null,
    sidebarMode: "layers",
    activeTool: "select",
    currentRegion: null,
    undoStack: [],
    redoStack: [],
    templateRegions: [{ id: "slot", region: { ...region } }],
  });
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(View)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("operation drag consumers", () => {
  it.each([
    ["narrow image", 0.005, 0.02, 228, 0.3],
    ["short image", 0.02, 0.005, 228, 0.3],
    ["left edge", 0.005, 0.02, -1000, 0],
    ["right edge", 0.005, 0.02, 5000, 0.995],
  ])("moves a restored %s without resizing it", (_name, w, h, clientX, expectedX) => {
    const restoredRegion = { ...region, w, h };
    const restored = parseSessionSnapshot({
      queue: [
        {
          ...useEditorStore.getState().queue[0],
          operations: [
            { id: "image", mode: "image", imagePath: "logo.png", region: restoredRegion },
          ],
        },
      ],
    });
    act(() => useEditorStore.setState(restored));
    expect(operation().region).toEqual(restoredRegion);
    act(() => drag.handleImageDragStart(operation(), 0, event()));
    move(clientX);
    end();
    expect(operation().region).toEqual({ ...restoredRegion, x: expect.closeTo(expectedX, 10) });
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(operation().region).toEqual(restoredRegion);
  });

  it.each(["image", "text", "blur", "crop", "delogo"])(
    "moves %s with one history step and flushes on mouseup",
    (mode) => {
      setOperation(mode);
      act(() => drag.handleImageDragStart(operation(), 0, event()));
      move(164);
      move(228);
      end();
      expect(operation().region).toEqual({ ...region, x: expect.closeTo(0.3) });
      expect(useEditorStore.getState().undoStack).toHaveLength(1);
      act(() => useEditorStore.getState().undo());
      expect(operation().region).toEqual(region);
    },
  );

  it.each(["blur", "datetime"])(
    "keeps a zero-delta %s click out of history and leaves the operation untouched",
    (mode) => {
      setOperation(mode, { rotation: 90 });
      const original = operation();
      act(() => drag.handleRegionOpDragStart(0, event()));
      move(100);
      end();
      expect(operation()).toBe(original);
      expect(useEditorStore.getState().undoStack).toHaveLength(0);
    },
  );

  it("updates a batch slot's own operation and draft through the same gesture", () => {
    setOperation("text");
    act(() => drag.handleBatchTextDragStart(useEditorStore.getState().templateRegions[0], event()));
    move(228);
    end();
    expect(operation().region.x).toBeCloseTo(0.3);
    expect(useEditorStore.getState().currentRegion).toEqual(operation().region);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
  });

  it("keeps a selected region's zero-delta gesture out of history", () => {
    setOperation("blur");
    act(() => useEditorStore.setState({ selectedOperationIdx: 0 }));
    act(() => drag.selectedRegionOpGestureWrapped.beginMove(event(), region));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100, clientY: 100 })));
    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
    act(() => drag.selectedRegionOpGestureWrapped.nudge(region, 0, 0));
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
    act(() => drag.selectedRegionOpGestureWrapped.nudge(region, 1, 0));
    expect(operation().region.x).toBeCloseTo(region.x + 1 / 640);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
  });

  it("maps source-axis movement onto the rotated output of a datetime stamp", () => {
    setOperation("datetime", { rotation: 90 });
    act(() => drag.handleImageDragStart(operation(), 0, event()));
    move(228);
    end();
    expect(operation().region).toEqual({
      ...region,
      y: expect.closeTo(0.3),
      x: expect.closeTo(0.2),
    });
  });

  it("preserves playback for operation drags and pauses it for batch text drags", () => {
    setOperation("image");
    videoRef.current.paused = false;
    act(() => drag.handleImageDragStart(operation(), 0, event()));
    expect(videoRef.current.pause).not.toHaveBeenCalled();
    end();
    setOperation("text");
    act(() => drag.handleBatchTextDragStart(useEditorStore.getState().templateRegions[0], event()));
    expect(videoRef.current.pause).toHaveBeenCalledTimes(1);
    end();
  });

  it.each(["a.mp4", "b.mp4"])(
    "drops the pending delta when another queue item is selected (%s)",
    (path) => {
      setOperation("image");
      act(() => drag.handleImageDragStart(operation(), 0, event()));
      move(228);
      act(() =>
        useEditorStore.setState((state) => ({
          queue: [...state.queue, { ...state.queue[0], path }],
          selectedIdx: 1,
        })),
      );
      end();
      expect(operation().region).toEqual(region);
      expect(useEditorStore.getState().queue[1].operations[0].region).toEqual(region);
      expect(frames.size).toBe(0);
    },
  );
});
