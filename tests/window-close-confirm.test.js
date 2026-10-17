import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  windows: [],
  showMessageBox: vi.fn(),
  hasActiveProcessing: vi.fn(),
  cancelRun: vi.fn(),
  isQuittingForUpdate: vi.fn(),
  hasUnexportedWork: vi.fn(),
  rendererReady: false,
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    constructor(options) {
      this.options = options;
      this.handlers = new Map();
      this.webContents = {
        on: vi.fn(),
        once: vi.fn(),
        getURL: vi.fn(() => ""),
        setWindowOpenHandler: vi.fn(),
        isLoading: () => !mocks.rendererReady,
        isCrashed: () => false,
        send: mocks.send,
      };
      this.close = vi.fn();
      this.setMenu = vi.fn();
      this.loadURL = vi.fn();
      this.loadFile = vi.fn();
      mocks.windows.push(this);
    }
    on(name, handler) {
      this.handlers.set(name, handler);
    }
    isDestroyed() {
      return false;
    }
  },
  dialog: { showMessageBox: mocks.showMessageBox },
}));
vi.mock("../main/shared-state.js", () => ({
  setMainWindow: vi.fn(),
  getHasUnexportedWork: mocks.hasUnexportedWork,
  isDev: false,
  DEV_URL: "http://localhost:5173",
}));
vi.mock("../main/processing-run.js", () => ({
  cancelRun: mocks.cancelRun,
  hasActiveProcessing: mocks.hasActiveProcessing,
}));
vi.mock("../main/utils/settings.js", () => ({ readSettings: () => ({ theme: "dark" }) }));
vi.mock("../main/utils/windowTheme.js", () => ({
  applyWindowTheme: vi.fn(),
  resolveWindowTheme: () => ({ background: "#000000", symbols: "#ffffff" }),
  TITLEBAR_OVERLAY_COLOR: "#000000",
  TITLEBAR_OVERLAY_HEIGHT: 32,
}));
vi.mock("../main/updater.js", () => ({
  isQuittingForUpdate: mocks.isQuittingForUpdate,
  init: vi.fn(),
}));

import { createWindow } from "../main/utils/window.js";
import { resolveCloseConfirm } from "../main/utils/closeConfirm.js";

const CONFIRM_CANCEL_AND_EXIT = 0;
const KEEP_PROCESSING = 1;

function openWindow() {
  createWindow();
  const win = mocks.windows.at(-1);
  return { win, close: () => win.handlers.get("close") };
}

describe("main window", () => {
  beforeEach(() => {
    mocks.windows.length = 0;
    mocks.showMessageBox.mockReset();
    mocks.hasActiveProcessing.mockReset().mockReturnValue(false);
    mocks.cancelRun.mockReset().mockResolvedValue({ success: true });
    mocks.isQuittingForUpdate.mockReset().mockReturnValue(false);
    mocks.hasUnexportedWork.mockReset().mockReturnValue(false);
    mocks.rendererReady = false;
    mocks.send.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("isolates the renderer: sandboxed, no node integration, web security on", () => {
    const { win } = openWindow();
    expect(win.options.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
  });

  it("closes immediately when nothing is processing or an update is installing", () => {
    const { close } = openWindow();
    const idle = { preventDefault: vi.fn() };
    close()(idle);
    expect(idle.preventDefault).not.toHaveBeenCalled();

    mocks.hasActiveProcessing.mockReturnValue(true);
    mocks.isQuittingForUpdate.mockReturnValue(true);
    const updating = { preventDefault: vi.fn() };
    close()(updating);
    expect(updating.preventDefault).not.toHaveBeenCalled();
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
  });

  it("keeps processing when the user declines to cancel", async () => {
    mocks.hasActiveProcessing.mockReturnValue(true);
    mocks.showMessageBox.mockResolvedValue({ response: KEEP_PROCESSING });
    const { win, close } = openWindow();
    const event = { preventDefault: vi.fn() };

    close()(event);
    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.cancelRun).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
  });

  it("cancels the run before closing once the user confirms, then lets the close through", async () => {
    mocks.hasActiveProcessing.mockReturnValue(true);
    mocks.showMessageBox.mockResolvedValue({ response: CONFIRM_CANCEL_AND_EXIT });
    const { win, close } = openWindow();
    const event = { preventDefault: vi.fn() };

    close()(event);
    await vi.waitFor(() => expect(win.close).toHaveBeenCalledTimes(1));

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.cancelRun.mock.invocationCallOrder[0]).toBeLessThan(
      win.close.mock.invocationCallOrder[0],
    );
    const reentrant = { preventDefault: vi.fn() };
    close()(reentrant);
    expect(reentrant.preventDefault).not.toHaveBeenCalled();
  });

  it("asks before closing with unexported queue work and stays open when declined", async () => {
    mocks.hasUnexportedWork.mockReturnValue(true);
    mocks.showMessageBox.mockResolvedValue({ response: 1 });
    const { win, close } = openWindow();
    const event = { preventDefault: vi.fn() };

    close()(event);
    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.showMessageBox.mock.calls[0][1].message).toMatch(/sin exportar/);
    expect(win.close).not.toHaveBeenCalled();
  });

  it("closes once the user accepts losing unexported queue work", async () => {
    mocks.hasUnexportedWork.mockReturnValue(true);
    mocks.showMessageBox.mockResolvedValue({ response: 0 });
    const { win, close } = openWindow();

    close()({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(win.close).toHaveBeenCalledTimes(1));

    const reentrant = { preventDefault: vi.fn() };
    close()(reentrant);
    expect(reentrant.preventDefault).not.toHaveBeenCalled();
  });

  it("asks through the in-app dialog when the renderer is ready", async () => {
    mocks.rendererReady = true;
    mocks.hasUnexportedWork.mockReturnValue(true);
    const { win, close } = openWindow();

    close()({ preventDefault: vi.fn() });
    const [channel, { id, processing }] = mocks.send.mock.calls[0];
    expect(channel).toBe("window:confirmClose");
    expect(processing).toBe(false);

    const repeated = { preventDefault: vi.fn() };
    close()(repeated);
    expect(repeated.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);

    resolveCloseConfirm(id, { ack: true });
    resolveCloseConfirm(id, { confirmed: true });
    await vi.waitFor(() => expect(win.close).toHaveBeenCalledTimes(1));
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
  });

  it("stays open when the in-app dialog is declined", async () => {
    mocks.rendererReady = true;
    mocks.hasActiveProcessing.mockReturnValue(true);
    const { win, close } = openWindow();

    close()({ preventDefault: vi.fn() });
    const { id } = mocks.send.mock.calls[0][1];
    resolveCloseConfirm(id, { ack: true });
    resolveCloseConfirm(id, { confirmed: false });
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.cancelRun).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
    close()({ preventDefault: vi.fn() });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
