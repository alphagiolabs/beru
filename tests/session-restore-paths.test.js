import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { createPathSecurity } from "../main/pathSecurity.js";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
}));

const trustedSenderEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

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
  isDev: false,
  DEV_URL: "http://localhost:5173",
}));
vi.mock("../main/utils/dialog-history.js", () => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));
vi.mock("../main/utils/processor-spawn.js", () => ({ validateProcessorAvailableAsync: vi.fn() }));
vi.mock("../main/utils/paths.js", () => ({ validateMediaBinaries: vi.fn() }));
vi.mock("../main/processing-run.js", () => ({ executeProcessingRun: vi.fn() }));

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

    const result = await restore(trustedSenderEvent, { videoPaths: [outsideFile] });
    expect(result.videos).toBe(0);
    expect(result.errors).toContain("Archivo fuera de ubicaciones permitidas");
  });

  it("loads a composition with its real authorization results in one response, including a moved source", async () => {
    const folder = path.join(trustedRoot, "home", "Videos");
    fs.mkdirSync(folder, { recursive: true });
    const source = path.join(folder, "a.mp4"),
      image = path.join(folder, "a.png"),
      missing = path.join(folder, "moved.mp4"),
      outside = path.join(outsideRoot, "outside.mp4");
    for (const file of [source, image, outside]) fs.writeFileSync(file, "fixture");
    const selected = path.join(folder, "saved.json");
    const value = {
      type: "beru-composition",
      version: 1,
      canvas: { width: 64, height: 64, fit: "contain" },
      fps: 30,
      entries: [source, missing, outside].map((video, i) => ({
        id: String(i),
        item: {
          path: video,
          width: 64,
          height: 64,
          duration: 1,
          operations: [{ mode: "image", imagePath: image }],
        },
      })),
    };
    fs.writeFileSync(selected, JSON.stringify(value));
    const security = createPathSecurity(makeNarrowApp(trustedRoot));
    const { showOpenDialog } = await import("../main/utils/dialog-history.js");
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [selected] });
    const { registerCompositionHandlers } = await import("../main/handlers/composition.js");
    registerCompositionHandlers(security);
    const result = await mocks.handlers.get("composition:load")(trustedSenderEvent, {});
    expect(result.success).toBe(true);
    expect(result.document.entries.map((entry) => entry.item.path)).toEqual([
      source,
      missing,
      outside,
    ]);
    expect(result.paths.videos).toBe(1);
    expect(result.paths.errors).toHaveLength(2);
    expect(security.validateReadableFile(source, "video").ok).toBe(true);
    expect(security.validateReadableFile(image, "image").ok).toBe(true);
    expect(security.validateReadableFile(outside, "video").ok).toBe(false);
  });
});
