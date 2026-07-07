import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  userData: "",
  appPath: "",
  codexPetsRoot: "",
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
    vi.resetModules();
    mocks.handlers.clear();
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "beru-petdex-"));
    repoRoot = path.resolve(".");
    mocks.userData = tempDirectory;
    mocks.codexPetsRoot = path.join(tempDirectory, "codex-pets");
    mocks.appPath = repoRoot;
    mocks.packaged = false;
    process.env.BERU_CODEX_PETS_ROOT = mocks.codexPetsRoot;
  });

  afterEach(() => {
    delete process.env.BERU_CODEX_PETS_ROOT;
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
      pets: [
        {
          slug: "boba",
          displayName: "Boba",
          spritesheetUrl: "https://x.test/s.webp",
          source: "beru",
        },
      ],
    });
  });

  it("lists pets installed via Codex CLI", async () => {
    const petDir = path.join(mocks.codexPetsRoot, "kebo");
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(
      path.join(petDir, "pet.json"),
      JSON.stringify({ id: "kebo", displayName: "Kebo" }),
    );
    fs.writeFileSync(path.join(petDir, "spritesheet.webp"), "webp");

    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const listHandler = mocks.handlers.get("petdex:listInstalled");
    await expect(listHandler()).resolves.toMatchObject({
      success: true,
      pets: [{ slug: "kebo", displayName: "Kebo", source: "codex" }],
    });
  });

  it("lists pets installed via petjson.json", async () => {
    const petDir = path.join(mocks.codexPetsRoot, "mallow");
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(
      path.join(petDir, "petjson.json"),
      JSON.stringify({ id: "mallow", displayName: "Mallow" }),
    );
    fs.writeFileSync(path.join(petDir, "sprite.webp"), "webp");

    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const listHandler = mocks.handlers.get("petdex:listInstalled");
    await expect(listHandler()).resolves.toMatchObject({
      success: true,
      pets: [{ slug: "mallow", displayName: "Mallow", source: "codex" }],
    });
  });

  it("returns spritesheet file paths for installed pets", async () => {
    const petDir = path.join(tempDirectory, "pets", "boba");
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(path.join(petDir, "pet.json"), JSON.stringify({ id: "boba" }));
    const spritesheetPath = path.join(petDir, "spritesheet.webp");
    fs.writeFileSync(spritesheetPath, Buffer.from("abc"));

    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const spritesheetHandler = mocks.handlers.get("petdex:getSpritesheet");
    const res = await spritesheetHandler({}, "boba");
    expect(res.success).toBe(true);
    expect(res.path).toBe(spritesheetPath);
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

  it("returns bundled spritesheet previews", async () => {
    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const bundledHandler = mocks.handlers.get("petdex:getBundledSpritesheet");
    const res = await bundledHandler({}, "boba");
    expect(res.success).toBe(true);
    expect(res.path).toMatch(/spritesheet\.webp$/);
  });

  it("exposes bundled catalog and boba assets in the repo", async () => {
    const { readBundledCatalog, isBundledPetAvailable } = await import("../main/utils/petdex.js");
    const bundled = readBundledCatalog();
    expect(bundled?.pets?.length).toBeGreaterThan(0);
    expect(bundled.pets.some((pet) => pet.slug === "boba")).toBe(true);
    expect(isBundledPetAvailable("boba")).toBe(true);
  });

  it("normalizes remote manifest entries", async () => {
    const { normalizeManifest } = await import("../main/utils/petdex.js");
    const normalized = normalizeManifest({
      total: 2,
      pets: [
        {
          slug: "boba",
          displayName: "Boba",
          spritesheetUrl: "https://assets.petdex.dev/curated/boba/spritesheet.webp",
          petJsonUrl: "https://assets.petdex.dev/curated/boba/pet.json",
        },
        { slug: "broken", displayName: "Broken" },
      ],
    });

    expect(normalized.total).toBe(1);
    expect(normalized.pets).toHaveLength(1);
    expect(normalized.pets[0].slug).toBe("boba");
  });

  it("fetches the remote pet manifest", async () => {
    const { fetchPetManifest } = await import("../main/utils/petdex.js");
    const result = await fetchPetManifest();
    console.log("Real fetchPetManifest result source:", result.source);
    console.log("Real fetchPetManifest result pets count:", result.manifest.pets.length);
    expect(result.source).toBe("remote");
    expect(result.manifest.pets.length).toBeGreaterThan(0);
  });
});
