import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import BrandFace from "../src/components/BrandFace.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

async function renderBrandFace() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(<BrandFace />);
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("BrandFace", () => {
  beforeEach(() => {
    useEditorStore.setState({ language: "es" });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
  });

  it("flips to the mascot face on click and back", async () => {
    await renderBrandFace();
    const btn = document.querySelector(".brand-face");

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(btn.classList.contains("brand-face--flipped")).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll(".brand-face-eye")).toHaveLength(2);

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(btn.classList.contains("brand-face--flipped")).toBe(false);
  });
});
