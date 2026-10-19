import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  openPath: vi.fn(),
}));

const trustedSenderEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

vi.mock("electron", () => ({
  app: { isPackaged: false },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  shell: {
    openPath: mocks.openPath,
    showItemInFolder: vi.fn(),
  },
}));

describe("Electron shell handler restrictions", () => {
  let tempDirectory;

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.openPath.mockReset().mockResolvedValue("");
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "beru-shell-"));
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("opens only output video files or directories", async () => {
    const videoPath = path.join(tempDirectory, "render.mp4");
    const executablePath = path.join(tempDirectory, "payload.exe");
    fs.writeFileSync(videoPath, "video");
    fs.writeFileSync(executablePath, "binary");

    const { registerFileHandlers } = await import("../main/handlers/file.js");
    registerFileHandlers({
      validateShellPath: vi.fn((targetPath) => ({ ok: true, resolvedPath: targetPath })),
    });
    const openPathHandler = mocks.handlers.get("shell:openPath");

    await expect(openPathHandler(trustedSenderEvent, videoPath)).resolves.toEqual({
      success: true,
    });
    await expect(openPathHandler(trustedSenderEvent, tempDirectory)).resolves.toEqual({
      success: true,
    });
    await expect(openPathHandler(trustedSenderEvent, executablePath)).resolves.toEqual({
      success: false,
      error: "Sólo se pueden abrir videos de salida o carpetas",
    });
    expect(mocks.openPath).toHaveBeenCalledTimes(2);
    expect(mocks.openPath).not.toHaveBeenCalledWith(executablePath);
  });
});
