import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import useEditorStore from "../src/stores/useEditorStore.js";
import StatusFooter from "../src/components/StatusFooter.jsx";
import UpdatePrompt from "../src/components/UpdatePrompt.jsx";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

function renderFooter() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  return act(async () => {
    root.render(
      <>
        <StatusFooter />
        <UpdatePrompt />
      </>,
    );
  });
}

function clickButton(matchingText) {
  const button = Array.from(document.querySelectorAll("button")).find((btn) =>
    btn.textContent.includes(matchingText),
  );
  expect(button).toBeTruthy();
  return act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("realistic update flow", () => {
  beforeEach(() => {
    useEditorStore.setState({
      isProcessing: false,
      progressDone: 0,
      progressTotal: 0,
      queue: [],
      batchSummary: null,
      language: "es",
      authStatus: "authenticated",
      updateModalOpen: false,
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
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
  });

  it("survives a duplicate background check and completes check → download → install", async () => {
    const downloadUpdate = vi.fn(async () => ({ ok: true }));
    const installUpdate = vi.fn(async () => ({ ok: true }));
    window.api = { downloadUpdate, installUpdate };

    useEditorStore.getState().applyUpdaterEvent({
      type: "available",
      version: "9.9.9",
      releaseNotes:
        "Fixed\n- fix: updater modal\n- fix: download race\nImproved\n- feat: Hermes-style UI",
      releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
    });

    await renderFooter();

    useEditorStore.getState().applyUpdaterEvent({ type: "checking" });
    expect(useEditorStore.getState().update.status).toBe("available");

    const versionBtn = document.querySelector(".status-footer-version--badge");
    expect(versionBtn).toBeTruthy();

    await act(async () => {
      useEditorStore.getState().setUpdateModalOpen(true);
    });

    await clickButton("Actualizar ahora");
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
    expect(downloadUpdate).toHaveBeenCalledWith({ version: "9.9.9" });
    expect(useEditorStore.getState().update.status).toBe("downloading");

    await act(async () => {
      useEditorStore.getState().applyUpdaterEvent({
        type: "downloading",
        version: "9.9.9",
        percent: 72,
        transferred: 7200,
        total: 10000,
      });
    });

    expect(document.body.textContent).toMatch(/72%/);

    await act(async () => {
      useEditorStore.getState().applyUpdaterEvent({
        type: "ready",
        version: "9.9.9",
      });
    });

    expect(document.body.textContent).toMatch(/Reiniciar e instalar/i);
    expect(installUpdate).not.toHaveBeenCalled();
    expect(document.querySelector(".status-footer-update-release-link")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Ver notas/i);

    await clickButton("Reiniciar e instalar");
    expect(installUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows an inline error when the download IPC fails immediately", async () => {
    window.api = {
      downloadUpdate: vi.fn(async () => ({ ok: false, error: "no-update-available" })),
    };

    useEditorStore.setState({
      updateModalOpen: true,
      update: {
        status: "available",
        version: "9.9.9",
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "- fix: inline error",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
      },
    });

    await renderFooter();

    await clickButton("Actualizar ahora");
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector(".status-footer-update-error")).toBeTruthy();
    expect(document.body.textContent).toMatch(/No se encontró la actualización/i);
    expect(useEditorStore.getState().update.status).toBe("available");
    expect(useEditorStore.getState().update.error).toBe("no-update-available");
  });
  it("shows an installation error and keeps the restart button available", async () => {
    window.api = {
      installUpdate: vi.fn(async () => ({ ok: false, error: "Installer could not start" })),
    };
    useEditorStore.setState({
      updateModalOpen: true,
      update: { status: "ready", version: "9.9.9", percent: 100 },
    });
    await renderFooter();
    await clickButton("Reiniciar e instalar");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Installer could not start",
    );
    expect(document.body.textContent).toMatch(/Reiniciar e instalar/);
    expect(useEditorStore.getState().update.status).toBe("ready");
  });

  it("does not claim the app is current before a check or after a failed manual check", async () => {
    window.api = {
      checkForUpdates: vi.fn(async () => {
        throw new Error("Connection unavailable");
      }),
    };
    await renderFooter();
    await act(async () =>
      document
        .querySelector(".status-footer-version")
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(document.body.textContent).not.toMatch(/Todo está al día/);
    await clickButton("Buscar actualizaciones");
    expect(window.api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/Todo está al día/);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Connection unavailable",
    );
    expect(document.querySelector(".status-footer-up-to-date-check")).toBeTruthy();
  });
});
