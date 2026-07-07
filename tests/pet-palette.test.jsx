import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import PetPaletteModal from "../src/components/pets/PetPaletteModal.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

describe("PetPaletteModal", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    window.api = {
      saveSettings: vi.fn(async () => ({ success: true, settings: {} })),
      getPetSpritesheet: vi.fn(async () => ({
        success: true,
        path: "C:\\pets\\boba\\spritesheet.webp",
      })),
    };
    useEditorStore.setState({
      showPetPalette: true,
      language: "es",
      petInstalled: [
        {
          slug: "boba",
          displayName: "Boba",
          spritesheetUrl: "https://assets.petdex.dev/curated/boba/spritesheet.webp",
        },
      ],
      petActiveSlug: null,
      petEnabled: false,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
      root = null;
    });
    document.body.innerHTML = "";
  });

  it("lists installed pets and adopts on click", async () => {
    const container = document.getElementById("root");
    root = createRoot(container);

    await act(async () => {
      root.render(<PetPaletteModal />);
    });

    expect(document.body.textContent).toContain("Mascotas");
    expect(document.body.textContent).toContain("Boba");

    const adoptButton = Array.from(document.querySelectorAll(".pet-palette-item")).find((el) =>
      el.textContent.includes("Boba"),
    );
    expect(adoptButton).toBeTruthy();

    await act(async () => {
      adoptButton.click();
    });

    expect(useEditorStore.getState().petActiveSlug).toBe("boba");
    expect(useEditorStore.getState().petEnabled).toBe(true);
    expect(useEditorStore.getState().showPetPalette).toBe(false);
  });
});
