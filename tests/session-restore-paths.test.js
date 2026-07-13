import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createPathSecurity } from "../main/pathSecurity.js";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
}));

vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}));

vi.mock("../main/shared-state.js", () => ({
  getMainWindow: vi.fn(() => null),
}));

function makeNarrowApp(trustedRoot) {
  return {
    getPath: (name) => {
      const map = {
        userData: path.join(trustedRoot, "userdata"),
        temp: path.join(trustedRoot, "temp"),
        home: path.join(trustedRoot, "home"),
        documents: path.join(trustedRoot, "home", "Documents"),
        downloads: path.join(trustedRoot, "home", "Downloads"),
        desktop: path.join(trustedRoot, "home", "Desktop"),
        videos: path.join(trustedRoot, "home", "Videos"),
        music: path.join(trustedRoot, "home", "Music"),
        pictures: path.join(trustedRoot, "home", "Pictures"),
      };
      return map[name] || trustedRoot;
    },
    isPackaged: false,
    getAppPath: () => path.join(trustedRoot, "app"),
  };
}

describe("session:restorePaths", () => {
  let trustedRoot;
  let outsideRoot;

  beforeEach(() => {
    mocks.handlers.clear();
    trustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-restore-trusted-"));
    outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-restore-outside-"));
    fs.mkdirSync(path.join(trustedRoot, "temp"), { recursive: true });
    fs.mkdirSync(path.join(trustedRoot, "app"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(trustedRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  it("counts only successful video restores and reports outside-root errors", async () => {
    const outsideFile = path.join(outsideRoot, "bad.mp4");
    fs.writeFileSync(outsideFile, Buffer.from("bad"));

    const pathSecurity = createPathSecurity(makeNarrowApp(trustedRoot));
    const { registerFileHandlers } = await import("../main/handlers/file.js");
    registerFileHandlers(pathSecurity);
    const restore = mocks.handlers.get("session:restorePaths");

    const result = await restore({}, { videoPaths: [outsideFile] });
    expect(result.videos).toBe(0);
    expect(result.errors).toContain("Archivo fuera de ubicaciones permitidas");
  });
});
