import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPathSecurity } from "../main/pathSecurity.js";
import { IPC_INVOKE } from "../shared/ipc-channels.js";

const mocks = vi.hoisted(() => ({ handlers: new Map(), select: vi.fn() }));
vi.mock("electron", () => ({
  ipcMain: { handle: (name, callback) => mocks.handlers.set(name, callback) },
  dialog: { showOpenDialog: mocks.select },
}));
vi.mock("../main/shared-state.js", () => ({ getMainWindow: () => null }));
import { registerDialogHandlers } from "../main/handlers/dialog.js";
import { registerFileHandlers } from "../main/handlers/file.js";

describe("native picker read consent", () => {
  let root;
  let security;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "beru-picker-"));
    security = createPathSecurity({
      isPackaged: false,
      getPath: () => path.join(root, "trusted"),
      getAppPath: () => path.join(root, "trusted"),
    });
    registerDialogHandlers(security);
    registerFileHandlers(security);
  });
  afterEach(() => {
    for (const name of fs.readdirSync(root)) fs.unlinkSync(path.join(root, name));
    fs.rmdirSync(root);
  });

  it.each([
    ["video", "selected.mp4", IPC_INVOKE.openVideos],
    ["excel", "selected.xlsx", IPC_INVOKE.openExcel],
    ["image", "selected.png", IPC_INVOKE.pickImage],
  ])(
    "grants access to the selected %s without granting its siblings",
    async (kind, filename, channel) => {
      const selected = path.join(root, filename);
      const sibling = path.join(root, `other-${filename}`);
      fs.writeFileSync(selected, "fixture");
      fs.writeFileSync(sibling, "fixture");
      expect(security.validateReadableFile(selected, kind).ok).toBe(false);
      mocks.select.mockResolvedValueOnce({ canceled: false, filePaths: [selected] });
      await mocks.handlers.get(channel)({});
      expect(security.validateReadableFile(selected, kind)).toMatchObject({
        ok: true,
        resolvedPath: selected,
      });
      expect(security.registerAllowedPath(sibling, kind).ok).toBe(false);
      expect(security.validateReadableFile(sibling, kind).ok).toBe(false);
    },
  );

  it("does not grant consent to a file with the wrong type", async () => {
    const selected = path.join(root, "payload.exe");
    fs.writeFileSync(selected, "fixture");
    mocks.select.mockResolvedValueOnce({ canceled: false, filePaths: [selected] });
    const result = await mocks.handlers.get(IPC_INVOKE.openVideos)({});
    expect(result).toEqual([]);
    expect(security.validateReadableFile(selected, "video").ok).toBe(false);
  });
});
