import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import AppRail from "../src/components/AppRail.jsx";
import { SettingsModal, TableEditor, WatermarkModal } from "../src/components/modal-panels.js";
import {
  AppearancePanel,
  UserManagementPanel,
} from "../src/components/settings/settings-panels.js";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.restoreAllMocks());

it("warms eligible panels on hover or focus without opening them or bypassing user permissions", async () => {
  const settings = vi.spyOn(SettingsModal, "preload").mockResolvedValue(undefined);
  const appearance = vi.spyOn(AppearancePanel, "preload").mockResolvedValue(undefined);
  const users = vi.spyOn(UserManagementPanel, "preload").mockResolvedValue(undefined);
  const table = vi.spyOn(TableEditor, "preload").mockResolvedValue(undefined);
  const watermark = vi.spyOn(WatermarkModal, "preload").mockResolvedValue(undefined);
  useEditorStore.setState({
    language: "es",
    queue: [],
    isProcessing: true,
    profile: { role: "user" },
    settingsTab: "users",
    showSettings: false,
    showTableEditor: false,
    showWatermarkModal: false,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const button = (label) => container.querySelector(`button[aria-label="${label}"]`);
  const hover = (label) =>
    act(() => button(label).dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
  try {
    await act(async () => root.render(<AppRail />));
    expect(settings).not.toHaveBeenCalled();
    expect(appearance).not.toHaveBeenCalled();
    expect(users).not.toHaveBeenCalled();
    hover("Ajustes");
    expect(settings).toHaveBeenCalledOnce();
    expect(appearance).toHaveBeenCalledOnce();
    expect(users).not.toHaveBeenCalled();
    expect(useEditorStore.getState().showSettings).toBe(false);

    act(() => button("Editor de tabla").focus());
    expect(table).not.toHaveBeenCalled();
    hover("Marca de agua");
    expect(watermark).not.toHaveBeenCalled();
    await act(async () =>
      useEditorStore.setState({ queue: [{ id: "video", path: "test.mp4" }], isProcessing: false }),
    );
    hover("Editor de tabla");
    expect(table).toHaveBeenCalledOnce();
    act(() => button("Marca de agua").focus());
    expect(watermark).toHaveBeenCalledOnce();
    expect(useEditorStore.getState().showTableEditor).toBe(false);
    expect(useEditorStore.getState().showWatermarkModal).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    useEditorStore.setState({
      queue: [],
      profile: null,
      settingsTab: "appearance",
      isProcessing: false,
    });
  }
});
