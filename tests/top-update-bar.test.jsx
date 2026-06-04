import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

describe("TopUpdateBar", () => {
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

  it("starts the native updater automatically instead of opening GitHub", async () => {
    const openExternal = vi.fn();
    const checkForUpdates = vi.fn(async () => ({ ok: true, version: "9.9.9" }));
    window.api = {
      openExternal,
      checkForUpdates,
      checkGitHubRelease: vi.fn(async () => ({
        ok: true,
        updateAvailable: true,
        latest: {
          version: "9.9.9",
          htmlUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
          installerUrl: "https://github.com/alphagiolabs/beru/releases/download/v9.9.9/Beru.exe",
        },
      })),
    };

    const { default: TopUpdateBar } = await import("../src/components/TopUpdateBar.jsx");

    await act(async () => {
      root.render(<TopUpdateBar />);
    });
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
    });
    expect(openExternal).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/Preparando actualización 9\.9\.9/i);
  });
});
