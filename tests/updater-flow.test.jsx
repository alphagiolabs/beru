import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import useEditorStore from "../src/stores/useEditorStore.js";
import StatusFooter from "../src/components/StatusFooter.jsx";
import UpdatePrompt from "../src/components/UpdatePrompt.jsx";
import { reduceUpdaterEvent, IDLE_UPDATE } from "../src/utils/updateState.js";

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
      executionHistory: [],
      batchSummary: null,
      language: "es",
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
    expect(document.querySelector(".status-footer-update-release-link")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Ver notas/i);

    await clickButton("Reiniciar e instalar");
    expect(installUpdate).toHaveBeenCalledTimes(1);
  });

  it("renders Hermes-style layout without scrollable changelog or release-notes link", async () => {
    window.api = {
      downloadUpdate: vi.fn(async () => ({ ok: true })),
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
        releaseNotes:
          "Fixed\n- fix: one\n- fix: two\nImproved\n- feat: one\n- feat: two\n- feat: three\n- feat: four\n- feat: five",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
      },
    });

    await renderFooter();

    const changelog = document.querySelector(".status-footer-update-changelog");
    const primaryBtn = document.querySelector(".status-footer-update-primary");
    const moreNote = document.querySelector(".status-footer-update-more");

    expect(changelog).toBeTruthy();
    expect(getComputedStyle(changelog).overflowY).not.toBe("auto");
    expect(getComputedStyle(changelog).maxHeight).not.toMatch(/px/);
    expect(document.querySelector(".status-footer-update-release-link")).toBeNull();
    expect(
      primaryBtn.compareDocumentPosition(moreNote) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
});

describe("reduceUpdaterEvent pending-update guard", () => {
  it("preserves an available update when duplicate check events arrive", () => {
    const available = reduceUpdaterEvent(IDLE_UPDATE, {
      type: "available",
      version: "9.9.9",
      releaseNotes: "- fix: modal",
    });

    expect(reduceUpdaterEvent(available, { type: "checking" })).toBe(available);
    expect(reduceUpdaterEvent(available, { type: "not-available" })).toBe(available);
  });
});
