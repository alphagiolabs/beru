import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  userData: "",
  appPath: "",
  codexPetsRoot: "",
  packaged: false,
}));

const trustedSenderEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

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

  it.each([
    {
      name: "lists installed pets from userData/pets",
      codex: false,
      slug: "boba",
      displayName: "Boba",
      manifest: "pet.json",
      sprite: "spritesheet.webp",
      meta: { spritesheetUrl: "https://x.test/s.webp" },
      source: "beru",
    },
    {
      name: "lists pets installed via Codex CLI",
      codex: true,
      slug: "kebo",
      displayName: "Kebo",
      manifest: "pet.json",
      sprite: "spritesheet.webp",
      source: "codex",
    },
    {
      name: "lists pets installed via petjson.json",
      codex: true,
      slug: "mallow",
      displayName: "Mallow",
      manifest: "petjson.json",
      sprite: "sprite.webp",
      source: "codex",
    },
  ])("$name", async ({ codex, slug, displayName, manifest, sprite, meta, source }) => {
    const petDir = path.join(codex ? mocks.codexPetsRoot : path.join(tempDirectory, "pets"), slug);
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(path.join(petDir, manifest), JSON.stringify({ id: slug, displayName }));
    if (meta) fs.writeFileSync(path.join(petDir, "meta.json"), JSON.stringify(meta));
    fs.writeFileSync(path.join(petDir, sprite), "webp");

    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const listHandler = mocks.handlers.get("petdex:listInstalled");
    await expect(listHandler(trustedSenderEvent)).resolves.toMatchObject({
      success: true,
      pets: [{ slug, displayName, source, ...meta }],
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
    const res = await spritesheetHandler(trustedSenderEvent, "boba");
    expect(res.success).toBe(true);
    expect(res.path).toBe(spritesheetPath);
  });

  it("installs bundled boba without network", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network disabled");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
      registerPetdexHandlers();

      const installHandler = mocks.handlers.get("petdex:install");
      const res = await installHandler(trustedSenderEvent, { slug: "boba", displayName: "Boba" });
      expect(res.success).toBe(true);
      expect(fs.existsSync(path.join(tempDirectory, "pets", "boba", "spritesheet.webp"))).toBe(
        true,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns bundled spritesheet previews", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network disabled");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
      registerPetdexHandlers();

      const bundledHandler = mocks.handlers.get("petdex:getBundledSpritesheet");
      const res = await bundledHandler(trustedSenderEvent, "boba");
      expect(res.success).toBe(true);
      expect(res.path).toMatch(/spritesheet\.webp$/);
      expect(fs.existsSync(res.path)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps offline bundled catalog available without network", async () => {
    const { readBundledCatalog } = await import("../main/utils/petdex-fs.js");
    const { normalizeManifest } = await import("../main/utils/petdex-core.js");
    const bundled = readBundledCatalog();
    expect(bundled?.pets?.length).toBeGreaterThan(0);
    const manifest = normalizeManifest(bundled);
    expect(manifest.pets.some((pet) => pet.slug === "boba")).toBe(true);
    expect(manifest.pets.every((pet) => pet.spritesheetUrl.includes("assets.petdex.dev"))).toBe(
      true,
    );
  });

  it("rejects path-traversal slugs on install", async () => {
    const { registerPetdexHandlers } = await import("../main/handlers/petdex.js");
    registerPetdexHandlers();

    const installHandler = mocks.handlers.get("petdex:install");
    const res = await installHandler(trustedSenderEvent, {
      slug: "../evil",
      displayName: "Evil",
      petJsonUrl: "https://assets.petdex.dev/curated/evil/pet.json",
      spritesheetUrl: "https://assets.petdex.dev/curated/evil/spritesheet.webp",
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Slug de mascota inválido/);
    expect(fs.existsSync(path.join(tempDirectory, "evil"))).toBe(false);
    expect(fs.existsSync(path.join(tempDirectory, "pets", "evil"))).toBe(false);
  });
});
