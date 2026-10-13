import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import PropertiesPanel from "../src/components/PropertiesPanel.jsx";
import VideoPreview from "../src/components/VideoPreview.jsx";
import PreviewCompareBar from "../src/components/video-preview/PreviewCompareBar.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { buildExportJob } from "../src/utils/export-pipeline.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (globalThis.HTMLCanvasElement) {
  globalThis.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    drawImage() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {},
    setTransform() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  });
}

window.api = window.api || {};

const queueItem = (operations = []) => ({
  path: "C:\\videos\\sample.mp4",
  src: "",
  filename: "sample.mp4",
  width: 1920,
  height: 1080,
  duration: 60,
  videoCodec: "",
  pixFmt: "yuv420p",
  frameRate: 30,
  audioCodec: "",
  operations,
  status: "idle",
  progress: 0,
  eta: null,
  speed: null,
  error: null,
  customOutputName: "",
  thumbnail: null,
});

const blurOp = (overrides = {}) => ({
  id: "op-blur-1",
  mode: "blur",
  region: { x: 0.1, y: 0.1, w: 0.2, h: 0.15 },
  blurStrength: 20,
  startTime: null,
  endTime: null,
  ...overrides,
});

const cropOp = (overrides = {}) => ({
  id: "op-crop-1",
  mode: "crop",
  region: { x: 0.1, y: 0.2, w: 0.4, h: 0.4 },
  startTime: null,
  endTime: null,
  ...overrides,
});

function setupAppliedOp(op) {
  useEditorStore.setState({
    sidebarMode: "logo",
    activeTool: "blur",
    currentRegion: null,
    queue: [queueItem([op])],
    selectedIdx: 0,
    selectedOperationIdx: 0,
    undoStack: [],
    redoStack: [],
  });
}

function renderInto(element) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(element);
  });
  return root;
}

function typeInto(input, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressKey(target, key, init = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

const appliedField = (label) =>
  document.querySelector(`[data-applied-region-editor='blur'] input[aria-label='${label}']`);

describe("applied region fields — partial input and history", () => {
  let root = null;

  beforeEach(() => {
    setupAppliedOp(blurOp());
    root = renderInto(React.createElement(PropertiesPanel));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("clearing a field keeps the region instead of jumping to 0", () => {
    typeInto(appliedField("X"), "");
    expect(useEditorStore.getState().queue[0].operations[0].region.x).toBeCloseTo(0.1, 10);
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
  });

  it("typing several values in one field records a single undo step", () => {
    typeInto(appliedField("X"), "384");
    typeInto(appliedField("X"), "400");
    typeInto(appliedField("X"), "420");
    expect(useEditorStore.getState().queue[0].operations[0].region.x).toBeCloseTo(420 / 1920, 6);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().queue[0].operations[0].region.x).toBeCloseTo(0.1, 10);
  });

  it("arrow keys step the field by 1 px and by 10 px with Shift", () => {
    pressKey(appliedField("X"), "ArrowUp");
    expect(useEditorStore.getState().queue[0].operations[0].region.x).toBeCloseTo(193 / 1920, 6);
    pressKey(appliedField("X"), "ArrowDown", { shiftKey: true });
    expect(useEditorStore.getState().queue[0].operations[0].region.x).toBeCloseTo(183 / 1920, 6);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
  });

  it("rounds typed pixels to whole pixels so the value round-trips", () => {
    typeInto(appliedField("Y"), "100.6");
    const region = useEditorStore.getState().queue[0].operations[0].region;
    expect(Math.round(region.y * 1080)).toBe(101);
    act(() => {
      appliedField("Y").focus();
      appliedField("Y").blur();
    });
    expect(appliedField("Y").value).toBe("101");
  });
});

describe("applied time range — partial input", () => {
  let root = null;

  beforeEach(() => {
    setupAppliedOp(blurOp());
    root = renderInto(React.createElement(PropertiesPanel));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("applies valid bounds, flags an end before the start and clears on empty", () => {
    const editor = document.querySelector("[data-applied-region-editor='blur']");
    const fieldFor = (text) =>
      Array.from(editor.querySelectorAll("label"))
        .find((label) => label.textContent.includes(text))
        .querySelector("input");
    const start = fieldFor("Inicio (s)");
    const end = fieldFor("Fin (s)");
    typeInto(start, "1.5");
    expect(useEditorStore.getState().queue[0].operations[0].startTime).toBe(1.5);

    typeInto(end, "1");
    expect(useEditorStore.getState().queue[0].operations[0].endTime).toBe(1);
    expect(editor.textContent).toMatch(/inválido/);

    typeInto(start, "");
    expect(useEditorStore.getState().queue[0].operations[0].startTime).toBeNull();
  });

  it("an incomplete entry keeps the stored bound until a number or an explicit clear", () => {
    const editor = document.querySelector("[data-applied-region-editor='blur']");
    const start = Array.from(editor.querySelectorAll("label"))
      .find((label) => label.textContent.includes("Inicio (s)"))
      .querySelector("input");
    typeInto(start, "5");
    expect(useEditorStore.getState().queue[0].operations[0].startTime).toBe(5);

    Object.defineProperty(start, "validity", { configurable: true, value: { badInput: true } });
    typeInto(start, "");
    expect(useEditorStore.getState().queue[0].operations[0].startTime).toBe(5);

    Object.defineProperty(start, "validity", { configurable: true, value: { badInput: false } });
    typeInto(start, "");
    expect(useEditorStore.getState().queue[0].operations[0].startTime).toBeNull();
  });
});

describe("crop presets", () => {
  let root = null;

  beforeEach(() => {
    setupAppliedOp(cropOp());
    root = renderInto(React.createElement(PropertiesPanel));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("re-proportions the crop to 16:9 around its centre and reports the permanent output size", () => {
    const editor = document.querySelector("[data-applied-region-editor='crop']");
    expect(editor.textContent).toMatch(/768×432 px/);
    const preset = Array.from(editor.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "16:9",
    );
    act(() => preset.click());
    const region = useEditorStore.getState().queue[0].operations[0].region;
    expect((region.w * 1920) / (region.h * 1080)).toBeCloseTo(16 / 9, 2);
    expect(region.x + region.w / 2).toBeCloseTo(0.3, 2);
    expect(region.y + region.h / 2).toBeCloseTo(0.4, 2);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
  });

  it("describes a timed crop as a temporary zoom that keeps the output size", () => {
    setupAppliedOp(cropOp({ startTime: 2, endTime: 5 }));
    act(() => root.unmount());
    root = renderInto(React.createElement(PropertiesPanel));
    const editor = document.querySelector("[data-applied-region-editor='crop']");
    expect(editor.textContent).toMatch(/zoom temporal/);
  });
});

describe("draft region fields", () => {
  let root = null;

  beforeEach(() => {
    useEditorStore.setState({
      sidebarMode: "logo",
      activeTool: "blur",
      currentRegion: { x: 0.1, y: 0.1, w: 0.2, h: 0.15 },
      selectedIdx: 0,
      selectedOperationIdx: null,
      queue: [queueItem([])],
      undoStack: [],
      redoStack: [],
      tempStart: null,
      tempEnd: null,
    });
    root = renderInto(React.createElement(PropertiesPanel));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("applies typed values to the draft and keeps it when a field is cleared", () => {
    const x = document.querySelector("input[aria-label='X']");
    typeInto(x, "");
    expect(useEditorStore.getState().currentRegion.x).toBeCloseTo(0.1, 10);
    typeInto(x, "384");
    expect(useEditorStore.getState().currentRegion.x).toBeCloseTo(0.2, 6);
  });

  it("stores typed draft time bounds without NaN", () => {
    const start = document.querySelector("input[placeholder='0']");
    typeInto(start, "-");
    expect(useEditorStore.getState().tempStart).toBeNull();
    typeInto(start, "2");
    expect(useEditorStore.getState().tempStart).toBe(2);
  });
});

describe("region frame — keyboard nudge", () => {
  let root = null;

  function mockVideoGeometry(video) {
    Object.defineProperty(video, "videoWidth", { value: 1920, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 1080, configurable: true });
    Object.defineProperty(video, "offsetWidth", { value: 640, configurable: true });
    Object.defineProperty(video, "offsetHeight", { value: 360, configurable: true });
    video.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      top: 0,
      left: 0,
      bottom: 360,
      right: 640,
      toJSON() {
        return {};
      },
    });
  }

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useEditorStore.setState({
      sidebarMode: "logo",
      activeTool: "blur",
      currentRegion: null,
      queue: [queueItem([])],
      selectedIdx: 0,
      selectedOperationIdx: null,
      undoStack: [],
      redoStack: [],
    });
    root = createRoot(document.getElementById("root"));
    act(() => {
      root.render(React.createElement(VideoPreview));
    });
    mockVideoGeometry(document.querySelector("video"));
    act(() => {
      useEditorStore.setState({ queue: [queueItem([blurOp()])], selectedOperationIdx: 0 });
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("moves the focused applied region by 1 px, or 10 px with Shift, as one undo step", () => {
    const seekSpy = vi.fn();
    window.addEventListener("beru:video:command", seekSpy);
    const frame = document.querySelector("[data-text-region-frame]");
    expect(frame).toBeTruthy();
    act(() => frame.focus());

    pressKey(frame, "ArrowRight");
    pressKey(frame, "ArrowDown", { shiftKey: true });

    const region = useEditorStore.getState().queue[0].operations[0].region;
    expect(region.x).toBeCloseTo(0.1 + 1 / 1920, 6);
    expect(region.y).toBeCloseTo(0.1 + 10 / 1080, 6);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(seekSpy).not.toHaveBeenCalled();
    window.removeEventListener("beru:video:command", seekSpy);
  });

  it("a nudge after undo opens a new step and clears the redo branch", () => {
    const frame = document.querySelector("[data-text-region-frame]");
    act(() => frame.focus());
    pressKey(frame, "ArrowRight");
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().redoStack).toHaveLength(1);

    pressKey(frame, "ArrowRight");
    const state = useEditorStore.getState();
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(0);
    expect(state.queue[0].operations[0].region.x).toBeCloseTo(0.1 + 1 / 1920, 6);
  });

  it("selecting another region while focused opens its own undo step", () => {
    const b = blurOp({ id: "op-blur-2", region: { x: 0.4, y: 0.4, w: 0.2, h: 0.15 } });
    act(() => useEditorStore.setState({ queue: [queueItem([blurOp(), b])] }));
    const frame = document.querySelector("[data-text-region-frame]");
    act(() => frame.focus());
    pressKey(frame, "ArrowRight");
    act(() => useEditorStore.getState().selectOperation(1));
    pressKey(document.querySelector("[data-text-region-frame]"), "ArrowRight");
    expect(useEditorStore.getState().undoStack).toHaveLength(2);

    act(() => useEditorStore.getState().undo());
    const [opA, opB] = useEditorStore.getState().queue[0].operations;
    expect(opA.region.x).toBeCloseTo(0.1 + 1 / 1920, 6);
    expect(opB.region.x).toBeCloseTo(0.4, 10);
  });

  it("Ctrl, Alt or Meta with an arrow leaves the region alone", () => {
    const frame = document.querySelector("[data-text-region-frame]");
    act(() => frame.focus());
    pressKey(frame, "ArrowRight", { ctrlKey: true });
    pressKey(frame, "ArrowDown", { altKey: true });
    pressKey(frame, "ArrowLeft", { metaKey: true });
    const region = useEditorStore.getState().queue[0].operations[0].region;
    expect(region.x).toBeCloseTo(0.1, 10);
    expect(region.y).toBeCloseTo(0.1, 10);
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
  });
});

describe("PreviewCompareBar — render status", () => {
  let root = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  function renderBar(props) {
    root = renderInto(
      React.createElement(PreviewCompareBar, {
        sidebarMode: "logo",
        compareMode: "ffmpeg",
        onSelectMode() {},
        onDismiss() {},
        ...props,
      }),
    );
    return document.querySelector("[role='status']");
  }

  it("shows nothing while the frame is current", () => {
    expect(renderBar({ loading: false, stale: false })).toBeNull();
  });

  it("announces a rendering frame", () => {
    expect(renderBar({ loading: true, stale: true })?.textContent).toBe("Renderizando…");
  });

  it("announces an outdated frame", () => {
    expect(renderBar({ loading: false, stale: true })?.textContent).toBe("Frame desactualizado");
  });
});

describe("draft and applied regions — same Job", () => {
  let root = null;
  const start = { x: 0.1, y: 0.1, w: 0.2, h: 0.15 };

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("typing the same pixel value in the draft or on an applied region exports the same operation", () => {
    useEditorStore.setState({
      sidebarMode: "logo",
      activeTool: "blur",
      currentRegion: { ...start },
      selectedIdx: 0,
      selectedOperationIdx: null,
      queue: [queueItem([])],
      undoStack: [],
      redoStack: [],
    });
    root = renderInto(React.createElement(PropertiesPanel));
    typeInto(document.querySelector("input[aria-label=X]"), "384");
    useEditorStore.getState().addOperation("blur");
    const drafted = useEditorStore.getState().queue[0];
    const draftJob = buildExportJob(drafted, 0, { outputPath: "out.mp4" });

    act(() => root.unmount());
    const applied = { ...drafted.operations[0], region: { ...start } };
    useEditorStore.setState({
      currentRegion: null,
      selectedOperationIdx: 0,
      queue: [{ ...queueItem([applied]) }],
      undoStack: [],
      redoStack: [],
    });
    root = renderInto(React.createElement(PropertiesPanel));
    typeInto(appliedField("X"), "384");
    const appliedJob = buildExportJob(useEditorStore.getState().queue[0], 0, {
      outputPath: "out.mp4",
    });

    expect(draftJob.operations[0].region).toEqual({ x: 384, y: 108, w: 384, h: 162 });
    expect(appliedJob.operations).toEqual(draftJob.operations);
  });
});

describe("delogo method help", () => {
  let root = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("names the method family before its description", () => {
    setupAppliedOp({
      id: "op-delogo-help",
      mode: "delogo",
      region: { x: 0.1, y: 0.1, w: 0.2, h: 0.15 },
      delogoMethod: "temporal",
      blurStrength: 20,
      temporalRadius: 3,
      mosaicSize: 12,
      mirrorSide: "right",
      edgeFeather: 6,
      startTime: null,
      endTime: null,
    });
    root = renderInto(React.createElement(PropertiesPanel));
    const editor = document.querySelector("[data-applied-region-editor=delogo]");
    expect(editor.textContent).toMatch(/Estimar fondo · Usa fotogramas cercanos alineados/);
  });

  it("method chips use a tooltip instead of a native title", () => {
    setupAppliedOp({
      id: "op-delogo-tip",
      mode: "delogo",
      region: { x: 0.1, y: 0.1, w: 0.2, h: 0.15 },
      delogoMethod: "blur",
      blurStrength: 20,
      temporalRadius: 3,
      mosaicSize: 12,
      mirrorSide: "right",
      edgeFeather: 6,
      startTime: null,
      endTime: null,
    });
    root = renderInto(React.createElement(PropertiesPanel));
    const editor = document.querySelector("[data-applied-region-editor=delogo]");
    expect(editor.querySelector("button[title]")).toBeNull();
    expect(editor.querySelector(".delogo-method-grid .ui-tooltip-anchor")).toBeTruthy();
  });
});

describe("applied region history — no-op edits", () => {
  let root = null;

  beforeEach(() => {
    setupAppliedOp(blurOp({ region: { x: 0, y: 0.1, w: 0.2, h: 0.15 } }));
    root = renderInto(React.createElement(PropertiesPanel));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("an edit clamped to no change does not arm the undo session for the next real edit", () => {
    typeInto(appliedField("X"), "-1");
    expect(useEditorStore.getState().undoStack).toHaveLength(0);

    typeInto(appliedField("X"), "384");
    expect(useEditorStore.getState().queue[0].operations[0].region.x).toBeCloseTo(384 / 1920, 6);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().queue[0].operations[0].region.x).toBe(0);
  });
});

describe("applied editors — one edit session per operation", () => {
  let root = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("the first edit of another zone records its own undo step", () => {
    const first = blurOp({ id: "op-a", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.15 } });
    const second = blurOp({ id: "op-b", region: { x: 0.5, y: 0.5, w: 0.2, h: 0.15 } });
    useEditorStore.setState({
      sidebarMode: "logo",
      activeTool: "blur",
      currentRegion: null,
      queue: [queueItem([first, second])],
      selectedIdx: 0,
      selectedOperationIdx: 0,
      undoStack: [],
      redoStack: [],
    });
    root = renderInto(React.createElement(PropertiesPanel));
    typeInto(appliedField("X"), "384");
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    act(() => useEditorStore.getState().selectOperation(1));
    typeInto(appliedField("X"), "700");
    expect(useEditorStore.getState().queue[0].operations[1].region.x).toBeCloseTo(700 / 1920, 6);
    expect(useEditorStore.getState().undoStack).toHaveLength(2);
  });
});
