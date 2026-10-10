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
    window.api = {
      setWindowTheme: vi.fn(),
      saveSettings: vi.fn(async () => ({})),
      loadSettings: vi.fn(async () => ({})),
      fetchPetManifest: vi.fn(async () => ({ success: true, manifest: { total: 0, pets: [] } })),
      listInstalledPets: vi.fn(async () => ({ success: true, pets: [] })),
    };
    useEditorStore.setState({
      showSettings: true,
      settingsTab: "appearance",
      themeActiveSlot: 2,
      themeSlot1: "beru-light",
      themeSlot2: "beru-dark",
      customThemes: [],
      profile: { email: "admin@test.com", role: "admin" },
      language: "es",
      petEnabled: false,
      petActiveSlug: null,
      petInstalled: [],
      petSpritesheet: null,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
      root = null;
    });
    document.body.innerHTML = "";
    delete window.api;
  });

  it("renders appearance panel with theme slots and library", async () => {
    const container = document.getElementById("root");
    root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal />);
      await import("../src/components/settings/AppearancePanel.jsx");
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
      await import("../src/components/settings/UserManagementPanel.jsx");
    });

    expect(useEditorStore.getState().settingsTab).toBe("users");
    expect(document.body.textContent).toContain("Usuarios");
    expect(document.querySelector(".settings-users")).toBeTruthy();
  });
});
