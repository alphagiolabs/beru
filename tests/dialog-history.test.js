import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPath: vi.fn(), open: vi.fn(), save: vi.fn() }));
vi.mock("electron", () => ({
  app: { getPath: mocks.getPath },
  dialog: { showOpenDialog: mocks.open, showSaveDialog: mocks.save },
}));
import { showOpenDialog, showSaveDialog } from "../main/utils/dialog-history.js";

describe("native dialog directory history", () => {
  let root;
  let home;
  let selectedDirectory;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "beru-dialog-history-"));
    home = path.join(root, "home");
    selectedDirectory = path.join(root, "Videos con acento á");
    fs.mkdirSync(home);
    fs.mkdirSync(selectedDirectory);
    mocks.getPath.mockImplementation((name) => (name === "home" ? home : root));
    mocks.open.mockReset().mockResolvedValue({ canceled: true, filePaths: [] });
    mocks.save.mockReset().mockResolvedValue({ canceled: true });
  });
  afterEach(() => {
    if (!root.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Invalid fixture");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("starts at home and preserves the selected file directory across module reloads", async () => {
    const selected = path.join(selectedDirectory, "entrada.mp4");
    const result = { canceled: false, filePaths: [selected] };
    mocks.open.mockResolvedValueOnce(result);
    await expect(showOpenDialog(null, { properties: ["openFile"] })).resolves.toBe(result);
    expect(mocks.open.mock.calls[0][1].defaultPath).toBe(home);
    vi.resetModules();
    const reloaded = await import("../main/utils/dialog-history.js");
    await reloaded.showOpenDialog(null, { properties: ["openFile"] });
    expect(mocks.open.mock.calls[1][1].defaultPath).toBe(selectedDirectory);
  });

  it("remembers the selected directory itself for an output folder picker", async () => {
    mocks.open.mockResolvedValueOnce({ canceled: false, filePaths: [selectedDirectory] });
    await showOpenDialog(null, { properties: ["openDirectory", "createDirectory"] });
    await showSaveDialog(null, { defaultPath: "proyecto.beru.json" });
    expect(mocks.save.mock.calls[0][1].defaultPath).toBe(
      path.join(selectedDirectory, "proyecto.beru.json"),
    );
  });

  it("remembers save destinations and preserves the next suggested filename", async () => {
    mocks.save.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(selectedDirectory, "salida.xlsx"),
    });
    await showSaveDialog(null, { defaultPath: "salida.xlsx" });
    await showSaveDialog(null, { defaultPath: "otra.xlsx" });
    expect(mocks.save.mock.calls[1][1].defaultPath).toBe(path.join(selectedDirectory, "otra.xlsx"));
  });

  it("keeps explicit absolute destinations and leaves history unchanged on cancellation", async () => {
    const destination = path.join(selectedDirectory, "salida.xlsx");
    await showSaveDialog(null, { defaultPath: destination });
    expect(mocks.save.mock.calls[0][1].defaultPath).toBe(destination);
    expect(fs.existsSync(path.join(root, "dialog-directory.json"))).toBe(false);
    await showOpenDialog(null, { properties: ["openFile"] });
    expect(mocks.open.mock.calls[0][1].defaultPath).toBe(home);
  });

  it.each([
    "invalid json",
    JSON.stringify({ directory: "relative" }),
    JSON.stringify({ directory: "C:\\missing-beru-fixture" }),
  ])("falls back to home for unusable saved history %s", async (contents) => {
    fs.writeFileSync(path.join(root, "dialog-directory.json"), contents);
    await showOpenDialog(null, { properties: ["openFile"] });
    expect(mocks.open.mock.calls[0][1].defaultPath).toBe(home);
  });
});
