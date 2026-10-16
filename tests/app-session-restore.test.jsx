import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => () => {};
window.api = {
  onProgress: noop,
  onJobProgress: noop,
  onComplete: noop,
  onSummary: noop,
  onJobError: noop,
  onFinished: noop,
  onError: noop,
  onUpdaterEvent: noop,
  checkForUpdates: async () => ({}),
  restoreSessionPaths: async () => ({ ok: true, errors: ["outputDir", "C:\\videos\\moved.mp4"] }),
};

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
useEditorStore.setState({ outputDir: "C:\\salida", language: "es", appToast: null });
const { default: App } = await import("../src/App.jsx");
const { seedAuthenticatedAuth } = await import("./helpers/authTestState.js");

let root;

afterEach(async () => {
  await act(() => root.unmount());
});

describe("session path restore on startup", () => {
  it("waits for path authorization before mounting the media workspace", async () => {
    let resolveRestore;
    const original = window.api.restoreSessionPaths;
    window.api.restoreSessionPaths = () =>
      new Promise((resolve) => {
        resolveRestore = resolve;
      });
    useEditorStore.setState({ outputDir: "C:\\salida", appToast: null });
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    try {
      await act(async () => {
        root.render(<App />);
      });
      expect(document.querySelector(".app-shell")).toBeNull();
    } finally {
      await act(async () => {
        resolveRestore({ errors: [] });
      });
      window.api.restoreSessionPaths = original;
    }
    expect(document.querySelector(".app-shell")).not.toBeNull();
  });

  it("warns and opens the workspace if restoring permissions rejects", async () => {
    const original = window.api.restoreSessionPaths;
    window.api.restoreSessionPaths = async () => {
      throw new Error("IPC unavailable");
    };
    useEditorStore.setState({ outputDir: "C:\\salida", appToast: null });
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    try {
      await act(async () => {
        root.render(<App />);
      });
      expect(useEditorStore.getState().appToast).toMatchObject({ kind: "warn" });
      expect(document.querySelector(".app-shell")).not.toBeNull();
    } finally {
      window.api.restoreSessionPaths = original;
    }
  });

  it("warns when paths from the previous session cannot be restored", async () => {
    await seedAuthenticatedAuth();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(useEditorStore.getState().appToast).toMatchObject({ kind: "warn" });
    expect(useEditorStore.getState().appToast.text).toMatch(/2 ruta/);
  });
});
