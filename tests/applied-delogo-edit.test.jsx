import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import PropertiesPanel from "../src/components/PropertiesPanel.jsx";
import VideoPreview from "../src/components/VideoPreview.jsx";
import useKeyboard from "../src/hooks/useKeyboard.js";
import useEditorStore from "../src/stores/useEditorStore.js";

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

window.api = {
  pickImage: vi.fn(async () => ({ success: true, path: "C:\\imgs\\patch.png" })),
  statImage: vi.fn(async () => ({ success: true, size: 4, mtimeMs: 1700000000000 })),
};

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

const delogoOp = (overrides = {}) => ({
  id: "op-delogo-1",
  mode: "delogo",
  region: { x: 0.7, y: 0.05, w: 0.2, h: 0.12 },
  delogoMethod: "blur",
  blurStrength: 20,
  delogoFillColor: "black",
  delogoFillOpacity: 1,
  delogoImagePath: "",
  temporalRadius: 3,
  mosaicSize: 12,
  mirrorSide: "right",
  edgeFeather: 6,
  startTime: null,
  endTime: null,
  ...overrides,
});

function setupSelectedOp(op) {
  useEditorStore.setState({
    sidebarMode: "logo",
    activeTool: "delogo",
    currentRegion: null,
    queue: [queueItem([op])],
    selectedIdx: 0,
    selectedOperationIdx: 0,
    undoStack: [],
    redoStack: [],
  });
}

function renderPanel() {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  act(() => {
    root.render(React.createElement(PropertiesPanel));
  });
  return root;
}

function KeyboardHarness() {
  useKeyboard();
  return null;
}

function renderKeyboard() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(React.createElement(KeyboardHarness));
  });
  return root;
}

function dispatchKey(key, init = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
}

describe("AppliedDelogoEditor — seguir editando zonas aplicadas", () => {
  beforeEach(() => {
    setupSelectedOp(blurOp());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("muestra el editor de desenfoque aplicado al seleccionar la zona", () => {
    const root = renderPanel();
    const editor = document.querySelector("[data-applied-region-editor='blur']");
    expect(editor).toBeTruthy();
    expect(editor.textContent).toMatch(/Desenfoque aplicado/);
    expect(editor.textContent).toMatch(/Arrástrala para moverla/);
    act(() => root.unmount());
  });

  it("el slider de intensidad actualiza el blurStrength de la operación", () => {
    const root = renderPanel();
    const slider = document.querySelector(
      "[data-applied-region-editor='blur'] input[aria-label='Intensidad de desenfoque']",
    );
    expect(slider).toBeTruthy();
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      nativeSetter.call(slider, "42");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(useEditorStore.getState().queue[0].operations[0].blurStrength).toBe(42);
    act(() => root.unmount());
  });

  it("el campo X actualiza la región de la operación", () => {
    const root = renderPanel();
    const xInput = document.querySelector(
      "[data-applied-region-editor='blur'] input[aria-label='X']",
    );
    expect(xInput).toBeTruthy();
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      nativeSetter.call(xInput, "384");
      xInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const region = useEditorStore.getState().queue[0].operations[0].region;
    expect(region.x).toBeCloseTo(384 / 1920, 5);
    act(() => root.unmount());
  });

  it("el botón Eliminar zona quita la operación", () => {
    const root = renderPanel();
    const deleteBtn = Array.from(
      document.querySelectorAll("[data-applied-region-editor='blur'] button"),
    ).find((b) => /Eliminar zona/.test(b.textContent || ""));
    expect(deleteBtn).toBeTruthy();
    act(() => {
      deleteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useEditorStore.getState().queue[0].operations).toEqual([]);
    act(() => root.unmount());
  });

  it("una operación delogo seleccionada permite cambiar de método", () => {
    setupSelectedOp(delogoOp());
    const root = renderPanel();
    const editor = document.querySelector("[data-applied-region-editor='delogo']");
    expect(editor).toBeTruthy();
    const mosaicBtn = Array.from(editor.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === "Mosaico",
    );
    expect(mosaicBtn).toBeTruthy();
    act(() => {
      mosaicBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useEditorStore.getState().queue[0].operations[0].delogoMethod).toBe("mosaic");
    act(() => root.unmount());
  });
});

describe("Quitar logo — método principal", () => {
  it("cambiar de desenfoque a recorte conserva la selección", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.2 };
    useEditorStore.setState({
      sidebarMode: "logo",
      activeTool: "blur",
      currentRegion: region,
      selectedIdx: 0,
      queue: [queueItem([])],
      selectedOperationIdx: null,
    });
    const root = renderPanel();
    const group = document.querySelector('[role="group"][aria-label="Método para quitar el logo"]');
    const crop = Array.from(group.querySelectorAll("button")).find((button) =>
      button.textContent.includes("Recortar"),
    );
    act(() => crop.click());
    expect(useEditorStore.getState().activeTool).toBe("crop");
    expect(useEditorStore.getState().currentRegion).toEqual(region);
    act(() => root.unmount());
  });
});

describe("useKeyboard — zonas de desenfoque aplicadas", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setupSelectedOp(blurOp());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Delete elimina la zona de desenfoque seleccionada", () => {
    const root = renderKeyboard();
    act(() => {
      dispatchKey("Delete");
    });
    expect(useEditorStore.getState().queue[0].operations).toEqual([]);
    act(() => root.unmount());
  });

  it("Escape deselecciona la operación sin borrarla", () => {
    const root = renderKeyboard();
    act(() => {
      dispatchKey("Escape");
    });
    expect(useEditorStore.getState().selectedOperationIdx).toBeNull();
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(1);
    act(() => root.unmount());
  });
});

describe("VideoPreview — zonas aplicadas seleccionables y arrastrables", () => {
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
    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    mockVideoGeometry(video);
    act(() => {
      useEditorStore.setState({ queue: [queueItem([blurOp()])] });
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("clic en la zona aplicada la selecciona y muestra el marco con esquinas", () => {
    const hit = document.querySelector(".cursor-grab");
    expect(hit).toBeTruthy();
    act(() => {
      hit.dispatchEvent(
        new MouseEvent("mousedown", { button: 0, clientX: 100, clientY: 50, bubbles: true }),
      );
    });
    expect(useEditorStore.getState().selectedOperationIdx).toBe(0);
    const handles = document.querySelectorAll("[data-text-region-frame] [data-handle]");
    expect(handles.length).toBe(8);
  });

  it("arrastrar la zona aplicada mueve su región", () => {
    const hit = document.querySelector(".cursor-grab");
    act(() => {
      hit.dispatchEvent(
        new MouseEvent("mousedown", { button: 0, clientX: 100, clientY: 50, bubbles: true }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 140, clientY: 50, bubbles: true }),
      );
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const region = useEditorStore.getState().queue[0].operations[0].region;
    expect(region.x).toBeCloseTo(0.1 + 40 / 640, 5);
    expect(region.y).toBeCloseTo(0.1, 5);
  });
});
