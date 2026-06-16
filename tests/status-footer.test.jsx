import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import useEditorStore from "../src/stores/useEditorStore";
import StatusFooter from "../src/components/StatusFooter";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

describe("StatusFooter", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    useEditorStore.setState({
      isProcessing: false,
      progressDone: 0,
      progressTotal: 0,
      queue: [],
      logLines: [],
      executionHistory: [],
      batchSummary: null,
      language: "es",
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
  });

  it("renders the Hermes-style footer with version info", async () => {
    await act(async () => {
      root.render(<StatusFooter />);
    });

    const footer = document.querySelector(".status-footer");
    expect(footer).toBeTruthy();
    expect(footer.textContent).toMatch(/v\d+\.\d+\.\d+/);
    expect(footer.textContent).toMatch(/Listo/i);
  });

  it("shows running state, job count, and segmented progress while processing", async () => {
    useEditorStore.setState({
      isProcessing: true,
      progressDone: 0,
      progressTotal: 2,
      queue: [
        { status: "processing", progress: 40 },
        { status: "idle", progress: 0 },
      ],
    });

    await act(async () => {
      root.render(<StatusFooter />);
    });

    const footer = document.querySelector(".status-footer");
    expect(footer.textContent).toMatch(/Procesando/i);
    expect(footer.textContent).toMatch(/0\/2/);
    expect(document.querySelector(".status-footer-progress")).toBeTruthy();
  });

  it("opens centered update modal from version badge when an update is available", async () => {
    window.api = {
      downloadUpdate: vi.fn(async () => ({ ok: true })),
    };

    useEditorStore.setState({
      update: {
        status: "available",
        version: "9.9.9",
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes:
          "What's new\n- feat: batch queue overhaul\n- Improve footer\nFixed\n- fix: batch queue",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
      },
    });

    await act(async () => {
      root.render(<StatusFooter />);
    });

    const versionBtn = document.querySelector(".status-footer-version--badge");
    expect(versionBtn).toBeTruthy();

    await act(async () => {
      versionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector(".status-footer-update-panel");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(document.body.textContent).toMatch(/Nueva actualización disponible/i);
    expect(document.body.textContent).toMatch(/Novedades/i);
    expect(document.body.textContent).toMatch(/Corregido/i);
    expect(document.body.textContent).toMatch(/Actualizar ahora/i);

    const updateNow = Array.from(document.querySelectorAll("button")).find((btn) =>
      btn.textContent.includes("Actualizar ahora"),
    );
    await act(async () => {
      updateNow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.api.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows the install step after the user authorizes a download and it finishes", async () => {
    window.api = {
      downloadUpdate: vi.fn(async () => ({ ok: true })),
      installUpdate: vi.fn(async () => ({ ok: true })),
    };

    useEditorStore.setState({
      update: {
        status: "available",
        version: "9.9.9",
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "- fix: footer polish",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
      },
    });

    await act(async () => {
      root.render(<StatusFooter />);
    });

    const versionBtn = document.querySelector(".status-footer-version--badge");
    await act(async () => {
      versionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const updateNow = Array.from(document.querySelectorAll("button")).find((btn) =>
      btn.textContent.includes("Actualizar ahora"),
    );
    await act(async () => {
      updateNow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.api.downloadUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      useEditorStore.setState({
        update: {
          status: "ready",
          version: "9.9.9",
          percent: 100,
          error: null,
          transferred: 1000,
          total: 1000,
          releaseNotes: "- fix: footer polish",
          releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
        },
      });
    });

    expect(document.body.textContent).toMatch(/Reiniciar e instalar/i);
    expect(window.api.installUpdate).not.toHaveBeenCalled();
  });

  it("auto-opens the install modal when an update finishes downloading", async () => {
    window.api = {
      installUpdate: vi.fn(async () => ({ ok: true })),
    };

    useEditorStore.setState({
      update: {
        status: "ready",
        version: "9.9.9",
        percent: 100,
        error: null,
        transferred: 1000,
        total: 1000,
        releaseNotes: "- fix: footer polish",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
      },
    });

    await act(async () => {
      root.render(<StatusFooter />);
    });

    const dialog = document.querySelector(".status-footer-update-panel");
    expect(dialog).toBeTruthy();
    expect(document.body.textContent).toMatch(/Reiniciar e instalar/i);

    const installBtn = Array.from(document.querySelectorAll("button")).find((btn) =>
      btn.textContent.includes("Reiniciar e instalar"),
    );
    await act(async () => {
      installBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(window.api.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("opens a centered confirmation when the current version is up to date", async () => {
    await act(async () => {
      root.render(<StatusFooter />);
    });

    const versionBtn = document.querySelector(".status-footer-version");
    await act(async () => {
      versionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector(".status-footer-up-to-date-panel");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.textContent).toMatch(/Todo está al día/i);
    expect(dialog.textContent).toMatch(/versión más reciente/i);

    await act(async () => {
      dialog
        .querySelector('button[aria-label="Cerrar"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector(".status-footer-up-to-date-panel")).toBeNull();
  });

  it("shows a release notes link when releaseUrl is present", async () => {
    window.api = {
      openExternal: vi.fn(async () => ({})),
    };

    useEditorStore.setState({
      update: {
        status: "available",
        version: "9.9.9",
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "Fixed\n- fix: batch queue",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
      },
    });

    await act(async () => {
      root.render(<StatusFooter />);
    });

    const versionBtn = document.querySelector(".status-footer-version--badge");
    await act(async () => {
      versionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const releaseLink = document.querySelector(".status-footer-update-release-link");
    expect(releaseLink).toBeTruthy();
    expect(releaseLink.textContent).toMatch(/Ver notas/i);

    await act(async () => {
      releaseLink.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(window.api.openExternal).toHaveBeenCalledWith(
      "https://github.com/alphagiolabs/beru/releases/tag/v9.9.9",
    );
  });

  it("shows a check-for-updates button in the up-to-date dialog", async () => {
    const checkForUpdates = vi.fn(async () => ({ ok: true }));
    window.api = {
      checkForUpdates,
    };

    await act(async () => {
      root.render(<StatusFooter />);
    });

    const versionBtn = document.querySelector(".status-footer-version");
    await act(async () => {
      versionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const checkBtn = document.querySelector(".status-footer-up-to-date-check");
    expect(checkBtn).toBeTruthy();
    expect(checkBtn.textContent).toMatch(/Buscar actualizaciones/i);

    await act(async () => {
      checkBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(checkForUpdates).toHaveBeenCalled();
    expect(document.querySelector(".status-footer-up-to-date-panel")).toBeNull();
  });
});
