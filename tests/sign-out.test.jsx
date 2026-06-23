import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";

vi.mock("../src/lib/supabaseClient.js", () => ({
  isSupabaseConfigured: true,
  getSupabase: vi.fn(() => null),
}));

import BeruRoot from "../src/BeruRoot.jsx";
import ConfirmDialog from "../src/components/ConfirmDialog.jsx";
import StatusFooter from "../src/components/StatusFooter.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { seedAuthenticatedAuthSync } from "./helpers/authTestState.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

describe("Sign out", () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    await seedAuthenticatedAuthSync({
      initAuth: vi.fn(async () => ({ ok: true })),
      signOut: vi.fn(async () => {
        useEditorStore.setState({
          authStatus: "unauthenticated",
          user: null,
          profile: null,
          authError: null,
        });
        return { ok: true };
      }),
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

  it("asks for confirmation and calls signOut from the footer button", async () => {
    await act(async () => {
      root.render(
        <>
          <StatusFooter />
          <ConfirmDialog />
        </>,
      );
    });

    const signOutBtn = document.querySelector('button[aria-label="Salir"]');
    expect(signOutBtn).toBeTruthy();

    await act(async () => {
      signOutBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(document.body.textContent).toMatch(/Cerrar sesión/i);

    const confirmBtn = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent.includes("Continuar"),
    );

    await act(async () => {
      confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useEditorStore.getState().signOut).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().authStatus).toBe("unauthenticated");
  });

  it("returns to the login screen after signing out", async () => {
    await act(async () => {
      root.render(<BeruRoot />);
    });

    expect(document.body.textContent).toMatch(/Importar videos/i);

    const signOutBtn = document.querySelector('button[aria-label="Salir"]');
    await act(async () => {
      signOutBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmBtn = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent.includes("Continuar"),
    );
    await act(async () => {
      confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useEditorStore.getState().signOut).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toMatch(/Inicia sesión para continuar/i);
    expect(document.body.textContent).not.toMatch(/Importar videos/i);
  });
});
