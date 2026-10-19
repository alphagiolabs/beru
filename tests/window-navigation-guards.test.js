import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: true },
  BrowserWindow: class {},
  dialog: {},
}));

vi.mock("../main/processing-run.js", () => ({
  cancelRun: vi.fn(),
  hasActiveProcessing: () => false,
}));

vi.mock("../main/utils/settings.js", () => ({ readSettings: () => ({ theme: "dark" }) }));

vi.mock("../main/utils/windowTheme.js", () => ({
  applyWindowTheme: vi.fn(),
  resolveWindowTheme: () => ({ background: "#0a0a0a", symbols: "#ffffff" }),
  TITLEBAR_OVERLAY_COLOR: "#00000000",
  TITLEBAR_OVERLAY_HEIGHT: 40,
}));

vi.mock("../main/updater.js", () => ({
  init: vi.fn(),
  isQuittingForUpdate: () => false,
}));

const { attachNavigationGuards } = await import("../main/utils/window.js");

function createFakeWin(currentUrl) {
  const handlers = {};
  const win = {
    webContents: {
      on: (event, handler) => {
        handlers[event] = handler;
      },
      setWindowOpenHandler: (handler) => {
        handlers.windowOpen = handler;
      },
      getURL: () => currentUrl,
    },
  };
  return { win, handlers };
}

describe("attachNavigationGuards", () => {
  it("allows only the window's own document", () => {
    for (const ownUrl of [
      "file:///C:/beru/build/index.html",
      "http://localhost:5173/",
      "http://localhost:5173/pet-overlay.html",
    ]) {
      const { win, handlers } = createFakeWin(ownUrl);
      attachNavigationGuards(win);

      const event = { preventDefault: vi.fn() };
      handlers["will-navigate"](event, ownUrl);

      expect(event.preventDefault).not.toHaveBeenCalled();
    }

    const { win, handlers } = createFakeWin("http://localhost:5173/");
    attachNavigationGuards(win);
    const blocked = { preventDefault: vi.fn() };
    handlers["will-navigate"](blocked, "http://localhost:5173/evil.html");
    expect(blocked.preventDefault).toHaveBeenCalled();
  });

  it("blocks navigation to external urls", () => {
    const { win, handlers } = createFakeWin("file:///C:/beru/build/index.html");
    attachNavigationGuards(win);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const url of ["https://example.com", "file:///C:/other/page.html"]) {
      const event = { preventDefault: vi.fn() };
      handlers["will-navigate"](event, url);

      expect(event.preventDefault).toHaveBeenCalled();
    }

    errorSpy.mockRestore();
  });

  it("denies every window.open attempt", () => {
    const { win, handlers } = createFakeWin("http://localhost:5173/");
    attachNavigationGuards(win);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const url of [
      "https://example.com",
      "file:///C:/other/page.html",
      "http://localhost:5173/",
    ]) {
      expect(handlers.windowOpen({ url })).toEqual({ action: "deny" });
    }

    errorSpy.mockRestore();
  });
});
