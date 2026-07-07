import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  userData: "",
  appPath: "",
  packaged: false,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: mocks.packaged,
    getPath: vi.fn((name) => {
      if (name === "userData") return mocks.userData;
      return "/tmp";
    }),
    getAppPath: vi.fn(() => mocks.appPath),
  },
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

describe("petdex handlers", () => {
  let tempDirectory;
  let repoRoot;

  beforeEach(() => {
    mocks.handlers.clear();
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "beru-petdex-"));
    repoRoot = path.resolve(".");
    mocks.userData = tempDirectory;
    mocks.appPath = repoRoot;
    mocks.packaged = false;
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("lists installed pets from userData/pets", async () => {
    const petDir = path.join(tempDirectory, "pets", "boba");
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(
      path.join(petDir, "pet.json"),
      JSON.stringify({ id: "boba", displayName: "Boba" }),
    );
    fs.writeFileSync(
      path.join(petDir, "meta.json"),
      JSON.stringify({ spritesheetUrl: "https://x.test/s.webp" }),
    );
    fs.writeFileSync(path.join(petDir, "spritesheet.webp"), "webp");

    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const listHandler = mocks.handlers.get("petdex:listInstalled");
    await expect(listHandler()).resolves.toMatchObject({
      success: true,
      pets: [{ slug: "boba", displayName: "Boba", spritesheetUrl: "https://x.test/s.webp" }],
    });
  });

  it("returns spritesheet data URLs for installed pets", async () => {
    const petDir = path.join(tempDirectory, "pets", "boba");
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(path.join(petDir, "pet.json"), JSON.stringify({ id: "boba" }));
    fs.writeFileSync(path.join(petDir, "spritesheet.webp"), Buffer.from("abc"));

    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const spritesheetHandler = mocks.handlers.get("petdex:getSpritesheet");
    const res = await spritesheetHandler({}, "boba");
    expect(res.success).toBe(true);
    expect(res.dataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  it("installs bundled boba without network", async () => {
    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const installHandler = mocks.handlers.get("petdex:install");
    const res = await installHandler({}, { slug: "boba", displayName: "Boba" });
    expect(res.success).toBe(true);
    expect(fs.existsSync(path.join(tempDirectory, "pets", "boba", "spritesheet.webp"))).toBe(true);
  });

  it("uninstalls an installed pet", async () => {
    const petDir = path.join(tempDirectory, "pets", "boba");
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(path.join(petDir, "pet.json"), JSON.stringify({ id: "boba" }));
    fs.writeFileSync(path.join(petDir, "spritesheet.webp"), "webp");

    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const uninstallHandler = mocks.handlers.get("petdex:uninstall");
    await expect(uninstallHandler({}, "boba")).resolves.toEqual({
      success: true,
      pet: { slug: "boba" },
    });
    expect(fs.existsSync(petDir)).toBe(false);
  });

  it("exposes bundled catalog and boba assets in the repo", async () => {
    const { readBundledCatalog, isBundledPetAvailable } = await import("../main/utils/petdex.js");
    const bundled = readBundledCatalog();
    expect(bundled?.pets?.length).toBeGreaterThan(0);
    expect(bundled.pets.some((pet) => pet.slug === "boba")).toBe(true);
    expect(isBundledPetAvailable("boba")).toBe(true);
  });
});
