import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const trustedSenderEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

const mocks = vi.hoisted(() => ({ handlers: new Map(), userData: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => mocks.userData },
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
}));

const { registerPresetHandlers } = await import("../main/handlers/preset.js");
const preset = JSON.stringify({ type: "beru-preset", name: "Mi preset" });
const save = (...args) => mocks.handlers.get("presets:save")(trustedSenderEvent, ...args);

beforeEach(() => {
  mocks.userData = fs.mkdtempSync(path.join(os.tmpdir(), "beru-presets-"));
  registerPresetHandlers();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(mocks.userData, { recursive: true, force: true });
});

describe("presets:save", () => {
  it("does not truncate a preset created before the exclusive write", async () => {
    const filePath = path.join(mocks.userData, "presets", "Mi preset.beru.json");
    await save("Mi preset", preset);
    fs.writeFileSync(filePath, "previous");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    expect(await save("Mi preset", preset)).toMatchObject({
      success: false,
      code: "preset_exists",
    });
    expect(fs.readFileSync(filePath, "utf8")).toBe("previous");
  });

  it("keeps an existing preset until overwrite is confirmed", async () => {
    const filePath = path.join(mocks.userData, "presets", "Mi preset.beru.json");
    expect(await save("Mi preset", preset)).toMatchObject({ success: true });
    fs.writeFileSync(filePath, "previous");

    expect(await save("Mi preset", preset)).toEqual({
      success: false,
      code: "preset_exists",
      fileName: "Mi preset.beru.json",
    });
    expect(fs.readFileSync(filePath, "utf8")).toBe("previous");

    expect(await save("Mi preset", preset, { overwrite: true })).toMatchObject({ success: true });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8")).name).toBe("Mi preset");
  });
});
