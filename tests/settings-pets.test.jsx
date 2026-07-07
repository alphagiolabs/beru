import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import SettingsModal from "../src/components/SettingsModal.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bobaEntry = {
  slug: "boba",
  displayName: "Boba",
  kind: "creature",
  spritesheetUrl: "https://assets.petdex.dev/curated/boba/spritesheet.webp",
  petJsonUrl: "https://assets.petdex.dev/curated/boba/pet.json",
};

const bobaSpritesheetPath = "C:\\pets\\boba\\spritesheet.webp";

let root = null;
let installedPets = [];

describe("SettingsModal pets", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    installedPets = [];
    window.api = {
      fetchPetManifest: vi.fn(async () => ({
        success: true,
        source: "bundled",
        manifest: { total: 1, pets: [bobaEntry] },
      })),
      listInstalledPets: vi.fn(async () => ({ success: true, pets: installedPets })),
      installPet: vi.fn(async () => {
        const pet = {
          slug: "boba",
          displayName: "Boba",
          spritesheetUrl: bobaEntry.spritesheetUrl,
          kind: "creature",
          source: "beru",
        };
        installedPets = [pet];
        return { success: true, pet };
      }),
      uninstallPet: vi.fn(async () => ({ success: true, pet: { slug: "boba" } })),
      getPetSpritesheet: vi.fn(async () => ({
        success: true,
        path: bobaSpritesheetPath,
      })),
      getBundledSpritesheet: vi.fn(async (slug) =>
        slug === "boba" ? { success: true, path: bobaSpritesheetPath } : { success: false },
      ),
      saveSettings: vi.fn(async () => ({ success: true, settings: {} })),
    };

    useEditorStore.setState({
      showSettings: true,
      settingsTab: "pets",
      language: "es",
      profile: { email: "user@test.com", role: "user" },
      petEnabled: false,
      petActiveSlug: null,
      petScale: 0.55,
      petInstalled: [],
      petManifest: { total: 1, pets: [bobaEntry] },
      petManifestLoading: false,
      petInstalledLoading: false,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
      root = null;
    });
    document.body.innerHTML = "";
  });

  it("installs and activates a pet from the gallery", async () => {
    const container = document.getElementById("root");
    root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal />);
    });

    const installButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent.includes("Instalar"),
    );
    expect(installButton).toBeTruthy();

    await act(async () => {
      installButton.click();
    });

    expect(window.api.installPet).toHaveBeenCalledWith(bobaEntry);
    expect(useEditorStore.getState().petActiveSlug).toBe("boba");
    expect(useEditorStore.getState().petEnabled).toBe(true);
    expect(useEditorStore.getState().petSpritesheet).toBe(
      "beru://local/C%3A%5Cpets%5Cboba%5Cspritesheet.webp",
    );
  });
});
