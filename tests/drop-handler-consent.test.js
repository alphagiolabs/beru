import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const trustedSenderEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

const handlers = vi.hoisted(() => new Map());
vi.mock("electron", () => ({
  app: { isPackaged: true },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
}));

const { createPathSecurity } = await import("../main/pathSecurity.js");
const { registerDropHandlers } = await import("../main/handlers/drop.js");

let trustedRoot;
let outsideRoot;
let security;

beforeEach(() => {
  trustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-drop-trusted-"));
  outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-drop-outside-"));
  security = createPathSecurity({
    getPath: (name) => path.join(trustedRoot, name),
    isPackaged: false,
    getAppPath: () => path.join(trustedRoot, "app"),
  });
  registerDropHandlers(security);
});

afterEach(() => {
  fs.rmSync(trustedRoot, { recursive: true, force: true });
  fs.rmSync(outsideRoot, { recursive: true, force: true });
});

const drop = (paths) => handlers.get("fs:resolveDroppedPaths")(trustedSenderEvent, paths);

describe("fs:resolveDroppedPaths", () => {
  it("grants access to videos dropped from outside the user folders", async () => {
    const folder = path.join(outsideRoot, "Grabaciones");
    fs.mkdirSync(folder);
    const clip = path.join(folder, "clip.mp4");
    fs.writeFileSync(clip, "video");

    const result = await drop([folder]);

    expect(result.ignoredCount).toBe(0);
    expect(result.videoPaths).toEqual([fs.realpathSync.native(clip)]);
    expect(security.validateReadableFile(clip, "video").ok).toBe(true);
  });

  it("returns only videos that passed validation and counts the rest as ignored", async () => {
    const accepted = path.join(outsideRoot, "a.mp4");
    const rejected = path.join(outsideRoot, "b.mp4");
    fs.writeFileSync(accepted, "video");
    fs.writeFileSync(rejected, "video");
    registerDropHandlers({ registerSelectedPaths: (paths) => paths.filter((p) => p === accepted) });

    expect(await drop([accepted, rejected, 42])).toEqual({
      videoPaths: [accepted],
      ignoredCount: 2,
    });
  });
});
