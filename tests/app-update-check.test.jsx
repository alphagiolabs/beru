import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

const noop = () => () => {};

let root = null;

describe("App update check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
  });

  afterEach(async () => {
    if (root) {
      await act(() => {
        root.unmount();
      });
      root = null;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("checks the native updater silently instead of rendering the old top banner", async () => {
    const checkForUpdates = vi.fn(async () => ({ ok: true, version: "9.9.9" }));
    window.api = {
      onProgress: noop,
      onJobProgress: noop,
      onComplete: noop,
      onSummary: noop,
      onJobError: noop,
      onFinished: noop,
      onError: noop,
      onLog: noop,
      onUpdaterEvent: noop,
      checkForUpdates,
      resolveDroppedPaths: async (paths) => ({ videoPaths: [], ignoredCount: paths.length }),
    };

    const { default: App } = await import("../src/App.jsx");

    await act(async () => {
      root.render(<App />);
    });

    expect(document.body.textContent).not.toMatch(/Preparando actualización/i);
    expect(document.body.textContent).not.toMatch(/Actualizar/i);

    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/Preparando actualización/i);
    expect(document.body.textContent).not.toMatch(/Actualizar/i);
  });
});
