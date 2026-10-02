import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  it("renders the Beru mark button", async () => {
    await renderBrandFace();
    const btn = document.querySelector(".brand-face");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".brand-face-mark")).toBeTruthy();
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

  it("moves the eyes toward the cursor", async () => {
    await renderBrandFace();
    const btn = document.querySelector(".brand-face");
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: 400 }));
    });

    const orb = document.querySelector(".brand-face-orb");
    expect(orb.style.getPropertyValue("--eye-x")).toBe("3.9px");
    expect(orb.style.getPropertyValue("--eye-y")).toBe("3.1px");
  });

  it("blinks the eyes on a timer", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div id="root"></div>';
      root = createRoot(document.getElementById("root"));
      await act(async () => {
        root.render(<BrandFace />);
        vi.advanceTimersByTime(10);
      });

      const btn = document.querySelector(".brand-face");
      await act(async () => {
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const orb = document.querySelector(".brand-face-orb");
      await act(async () => {
        vi.advanceTimersByTime(2700);
      });
      expect(orb.style.getPropertyValue("--eye-squash")).toBe("0.15");

      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(orb.style.getPropertyValue("--eye-squash")).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });
});
