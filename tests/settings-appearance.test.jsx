import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import SettingsModal from "../src/components/SettingsModal.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

describe("SettingsModal appearance", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useEditorStore.setState({
      showSettings: true,
      settingsTab: "appearance",
      themeActiveSlot: 2,
      themeSlot1: "beru-light",
      themeSlot2: "beru-dark",
      customThemes: [],
      profile: { email: "admin@test.com", role: "admin" },
      language: "es",
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
      root = null;
    });
    document.body.innerHTML = "";
  });

  it("renders appearance panel with theme slots and library", async () => {
    const container = document.getElementById("root");
    root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal />);
    });

    expect(document.body.textContent).toContain("Acceso rápido");
    expect(document.body.textContent).toContain("Tema 1");
    expect(document.body.textContent).toContain("Tema 2");
    expect(document.body.textContent).toContain("Biblioteca de temas");
    expect(document.querySelector(".settings-modal-nav-item--active")?.textContent).toContain(
      "Apariencia",
    );
  });

  it("switches to users tab for admin", async () => {
    const container = document.getElementById("root");
    root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal />);
    });

    const usersTab = Array.from(document.querySelectorAll(".settings-modal-nav-item")).find((el) =>
      el.textContent.includes("Usuarios"),
    );
    expect(usersTab).toBeTruthy();

    await act(async () => {
      usersTab.click();
    });

    expect(useEditorStore.getState().settingsTab).toBe("users");
    expect(document.body.textContent).toContain("Usuarios");
  });

  it("switches to pets tab and shows companion settings", async () => {
    const container = document.getElementById("root");
    root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal />);
    });

    const petsTab = Array.from(document.querySelectorAll(".settings-modal-nav-item")).find((el) =>
      el.textContent.includes("Mascotas"),
    );
    expect(petsTab).toBeTruthy();

    await act(async () => {
      petsTab.click();
    });

    expect(useEditorStore.getState().settingsTab).toBe("pets");
    expect(document.body.textContent).toContain("Galería de mascotas");
    expect(document.body.textContent).toContain("Compañero animado");
  });
});
