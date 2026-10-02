import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import useKeyboard from "../src/hooks/useKeyboard.js";
import AppRail from "../src/components/AppRail.jsx";
import WatermarkModal from "../src/components/WatermarkModal.jsx";
import AppliedDelogoEditor from "../src/components/AppliedDelogoEditor.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root = null;
let api = { openExcel: async () => null };
window.api = api;

function KbHost() {
  useKeyboard();
  return null;
}

async function mount(node) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(node);
    await new Promise((r) => setTimeout(r, 10));
  });
}

function pressEscape() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

const REGION = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

describe("Escape cierra modales sin tocar el estado de atrás", () => {
  beforeEach(async () => {
    useEditorStore.setState({
      language: "es",
      showSettings: false,
      showWatermarkModal: false,
      updateModalOpen: false,
      showShortcuts: false,
      showTableEditor: false,
      showMappingModal: false,
      showPetPalette: false,
      confirmDialog: null,
      currentRegion: { ...REGION },
      selectedOperationIdx: 0,
      appToast: null,
    });
    await mount(<KbHost />);
  });

  afterEach(async () => {
    if (root) await act(() => root.unmount());
    root = null;
  });

  it("cierra SettingsModal", () => {
    useEditorStore.setState({ showSettings: true });
    pressEscape();
    expect(useEditorStore.getState().showSettings).toBe(false);
    expect(useEditorStore.getState().currentRegion).toEqual(REGION);
  });

  it("cierra WatermarkModal", () => {
    useEditorStore.setState({ showWatermarkModal: true });
    pressEscape();
    expect(useEditorStore.getState().showWatermarkModal).toBe(false);
    expect(useEditorStore.getState().currentRegion).toEqual(REGION);
  });

  it("cierra UpdatePrompt", () => {
    useEditorStore.setState({ updateModalOpen: true });
    pressEscape();
    expect(useEditorStore.getState().updateModalOpen).toBe(false);
    expect(useEditorStore.getState().currentRegion).toEqual(REGION);
  });

  it("con ConfirmDialog abierto no muta la selección", () => {
    useEditorStore.setState({ confirmDialog: { message: "borrar?" } });
    pressEscape();
    expect(useEditorStore.getState().currentRegion).toEqual(REGION);
  });

  it("sin modales sigue limpiando la región activa", () => {
    pressEscape();
    expect(useEditorStore.getState().currentRegion).toBeNull();
  });
});

describe("Editor de tabla con cola vacía", () => {
  beforeEach(() => {
    useEditorStore.setState({
      language: "es",
      sidebarMode: "batch",
      queue: [],
      showTableEditor: false,
      appToast: null,
    });
  });

  afterEach(async () => {
    if (root) await act(() => root.unmount());
    root = null;
  });

  it("muestra toast en vez de abrir un modal vacío", async () => {
    await mount(<AppRail />);
    const btn = Array.from(document.querySelectorAll(".app-rail button")).find(
      (b) => b.getAttribute("aria-label") === "Editor de tabla",
    );
    await act(async () => {
      btn.click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(useEditorStore.getState().showTableEditor).toBe(false);
    expect(useEditorStore.getState().appToast?.text).toMatch(/videos/i);
  });

  it("abre el modal cuando hay videos", async () => {
    useEditorStore.setState({
      queue: [createQueueItem({ path: "C:\\v.mp4", filename: "v.mp4", width: 100, height: 100 })],
    });
    await mount(<AppRail />);
    const btn = Array.from(document.querySelectorAll(".app-rail button")).find(
      (b) => b.getAttribute("aria-label") === "Editor de tabla",
    );
    await act(async () => {
      btn.click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(useEditorStore.getState().showTableEditor).toBe(true);
  });
});

describe("WatermarkModal picker", () => {
  beforeEach(() => {
    useEditorStore.setState({
      language: "es",
      showWatermarkModal: true,
      watermark: {
        enabled: true,
        type: "image",
        text: "",
        imagePath: "C:\\img\\logo.png",
        imageDataUrl: "data:image/png;base64,xx",
        scale: 0.2,
        opacity: 0.8,
        position: "bottom-right",
      },
    });
    api.pickImage = vi.fn(async () => ({ canceled: true }));
  });

  afterEach(async () => {
    if (root) await act(() => root.unmount());
    root = null;
    delete api.pickImage;
  });

  it("cancelar el diálogo conserva la imagen configurada", async () => {
    await mount(<WatermarkModal />);
    const pick = Array.from(document.querySelectorAll("button")).find((b) =>
      /elegir/i.test(b.textContent),
    );
    await act(async () => {
      pick.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    const wm = useEditorStore.getState().watermark;
    expect(wm.imagePath).toBe("C:\\img\\logo.png");
    expect(wm.imageDataUrl).toBe("data:image/png;base64,xx");
  });
});

describe("Operaciones de imagen", () => {
  beforeEach(() => {
    useEditorStore.setState({
      language: "es",
      sidebarMode: "logo",
      queue: [
        createQueueItem({
          path: "C:\\v.mp4",
          filename: "v.mp4",
          width: 1920,
          height: 1080,
          operations: [
            {
              mode: "image",
              imagePath: "C:\\img\\w.png",
              imageOpacity: 0.5,
              region: { ...REGION },
            },
          ],
        }),
      ],
      selectedIdx: 0,
      selectedOperationIdx: 0,
      currentRegion: null,
      showSettings: false,
      showWatermarkModal: false,
      updateModalOpen: false,
      showTableEditor: false,
      showMappingModal: false,
      showShortcuts: false,
      confirmDialog: null,
      showPetPalette: false,
    });
  });

  afterEach(async () => {
    if (root) await act(() => root.unmount());
    root = null;
  });

  it("AppliedDelogoEditor muestra editor para ops de imagen", async () => {
    await mount(
      <AppliedDelogoEditor
        op={useEditorStore.getState().queue[0].operations[0]}
        videoIdx={0}
        opIdx={0}
        video={useEditorStore.getState().queue[0]}
      />,
    );
    expect(document.body.textContent).toMatch(/Imagen aplicada/);
    expect(document.querySelector('input[type="range"]')).toBeTruthy();
  });

  it("Delete elimina una op de imagen seleccionada", async () => {
    await mount(<KbHost />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(0);
  });
});
