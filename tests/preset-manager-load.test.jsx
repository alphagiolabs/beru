import { act } from "react";
import * as ReactRuntime from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import PresetManager from "../src/components/PresetManager.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
globalThis.React = ReactRuntime;

it("loads the saved document from the preset list", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const region = { id: 7, label: "TEXT_1", region: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } };
  useEditorStore.setState({
    language: "es",
    queue: [],
    templateRegions: [],
    textFontSize: 18,
    excelRows: [],
    excelMapping: { idColumn: null, columns: {} },
    presets: [
      {
        name: "Saved",
        filename: "saved.beru.json",
        data: {
          type: "beru-preset",
          templateRegions: [region],
          textStyle: { textFontSize: 72 },
        },
      },
    ],
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<PresetManager />));
    await act(() => host.querySelector(".inspector-user-presets-load").click());
    expect(useEditorStore.getState().textFontSize).toBe(72);
    expect(useEditorStore.getState().templateRegions).toMatchObject([region]);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
