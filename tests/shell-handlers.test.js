import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  shell: {
    openExternal: mocks.openExternal,
    openPath: mocks.openPath,
    showItemInFolder: vi.fn(),
  },
}));

vi.mock("../main/updater.js", () => ({
  checkForUpdates: vi.fn(),
  getSnapshot: vi.fn(),
  install: vi.fn(),
  startDownload: vi.fn(),
}));

describe("Electron shell handler restrictions", () => {
  let tempDirectory;

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.openExternal.mockReset().mockResolvedValue(undefined);
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

    await expect(openPathHandler({}, videoPath)).resolves.toEqual({ success: true });
    await expect(openPathHandler({}, tempDirectory)).resolves.toEqual({ success: true });
    await expect(openPathHandler({}, executablePath)).resolves.toMatchObject({ success: false });
    expect(mocks.openPath).toHaveBeenCalledTimes(2);
  });

  it("opens only HTTPS URLs on approved public domains", async () => {
    const { registerUpdaterHandlers } = await import("../main/handlers/updater.js");
    registerUpdaterHandlers();
    const openExternalHandler = mocks.handlers.get("shell:openExternal");

    for (const url of [
      "https://github.com/alphagiolabs/beru/releases",
      "https://beru.app/download",
    ]) {
      await expect(openExternalHandler({}, url)).resolves.toEqual({ success: true });
    }

    for (const url of [
      "http://github.com/alphagiolabs/beru",
      "https://github.com.evil.example/payload",
      "https://localhost/update",
      "https://127.0.0.1/update",
      "https://10.0.0.8/update",
      "https://172.16.0.8/update",
      "https://192.168.1.8/update",
    ]) {
      await expect(openExternalHandler({}, url)).resolves.toMatchObject({ success: false });
    }
    expect(mocks.openExternal).toHaveBeenCalledTimes(2);
  });

  it("keeps BrowserWindow web security settings explicit", () => {
    const windowSource = fs.readFileSync("main/utils/window.js", "utf8");

    expect(windowSource).toMatch(/webSecurity:\s*true/);
    expect(windowSource).toMatch(/allowRunningInsecureContent:\s*false/);
  });
});
