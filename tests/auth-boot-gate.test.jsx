import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";

vi.mock("../src/lib/supabaseClient.js", () => ({
  isSupabaseConfigured: true,
  getSupabase: vi.fn(() => null),
}));

import BeruRoot from "../src/BeruRoot.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { seedAuthenticatedAuthSync } from "./helpers/authTestState.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => () => {};
const asyncNoop = async () => ({});
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
  checkForUpdates: asyncNoop,
  resolveDroppedPaths: async (paths) => ({ videoPaths: [], ignoredCount: paths.length }),
};

let root = null;

describe("Auth boot gate", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    useEditorStore.setState({
      language: "es",
      appToast: null,
      update: {
        status: "idle",
        version: null,
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "",
        releaseUrl: null,
      },
    });
  });

  afterEach(async () => {
    if (root) {
      await act(() => {
        root.unmount();
      });
      root = null;
    }
    vi.clearAllMocks();
  });

  it("does not flash the login screen while restoring a session", async () => {
    useEditorStore.setState({
      authStatus: "loading",
      user: null,
      profile: null,
      authError: null,
      // Stay loading: simulate a slow getSession / profile fetch on boot.
      initAuth: vi.fn(async () => new Promise(() => {})),
    });

    await act(async () => {
      root.render(<BeruRoot />);
    });

    expect(document.querySelector('[data-testid="auth-session-loading"]')).toBeTruthy();
    expect(document.body.textContent).toMatch(/Verificando sesión/i);
    // Cinematic login chrome must not mount during session restore.
    expect(document.querySelector(".login-cinematic")).toBeNull();
    expect(document.querySelector(".login-cinematic-video")).toBeNull();
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Importar videos/i);
  });

  it("shows the login screen only when unauthenticated", async () => {
    useEditorStore.setState({
      authStatus: "unauthenticated",
      user: null,
      profile: null,
      authError: null,
      initAuth: vi.fn(async () => ({ ok: false, reason: "no-session" })),
    });

    await act(async () => {
      root.render(<BeruRoot />);
    });

    expect(document.querySelector(".login-cinematic")).toBeTruthy();
    expect(document.querySelector('input[type="email"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="auth-session-loading"]')).toBeNull();
  });

  it("shows the app when already authenticated", async () => {
    await seedAuthenticatedAuthSync({
      initAuth: vi.fn(async () => ({ ok: true })),
    });

    await act(async () => {
      root.render(<BeruRoot />);
    });

    expect(document.querySelector('[data-testid="auth-session-loading"]')).toBeNull();
    expect(document.querySelector(".login-cinematic")).toBeNull();
    expect(document.body.textContent).toMatch(/Importar videos/i);
  });
});
