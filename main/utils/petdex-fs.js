import { app } from "electron";
import fs from "fs";
import { homedir } from "node:os";
import path from "path";
import { fileURLToPath } from "url";
import { safePetSlug } from "./petdex-core.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function getPetsRoot() {
  return path.join(app.getPath("userData"), "pets");
}

function getCodexPetsRoot() {
  if (process.env.BERU_CODEX_PETS_ROOT) {
    return process.env.BERU_CODEX_PETS_ROOT;
  }
  return path.join(homedir(), ".codex", "pets");
}

function getManifestCachePath() {
  return path.join(app.getPath("userData"), "pet-manifest.json");
}

function getBundledPetsRoot() {
  const candidates = [
    path.join(MODULE_DIR, "..", "..", "resources", "pets"),
    app.isPackaged && process.resourcesPath ? path.join(process.resourcesPath, "pets") : null,
    path.join(app.getAppPath(), "resources", "pets"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "catalog.json"))) return candidate;
  }

  return candidates[0];
}

export function readBundledCatalog() {
  const catalogPath = path.join(getBundledPetsRoot(), "catalog.json");
  if (!fs.existsSync(catalogPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (!parsed || !Array.isArray(parsed.pets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readCachedManifest() {
  const cachePath = getManifestCachePath();
  if (!fs.existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (!parsed || !Array.isArray(parsed.pets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeManifestCache(manifest) {
  fs.writeFileSync(getManifestCachePath(), JSON.stringify(manifest));
}

function resolveSpritesheetFile(petDir) {
  if (!fs.existsSync(petDir)) return null;
  for (const name of ["spritesheet.webp", "spritesheet.png", "sprite.webp", "sprite.png"]) {
    const candidate = path.join(petDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  const files = fs.readdirSync(petDir).filter((name) => /\.(webp|png)$/i.test(name));
  return files.length > 0 ? path.join(petDir, files[0]) : null;
}

function resolvePetJsonFile(petDir) {
  for (const name of ["pet.json", "petjson.json"]) {
    const candidate = path.join(petDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readPetFromDir(petDir, slug, source) {
  const petJsonPath = resolvePetJsonFile(petDir);
  if (!petJsonPath) return null;

  let meta = {};
  let installMeta = {};
  try {
    meta = JSON.parse(fs.readFileSync(petJsonPath, "utf8"));
  } catch {
    return null;
  }

  const installMetaPath = path.join(petDir, "meta.json");
  if (fs.existsSync(installMetaPath)) {
    try {
      installMeta = JSON.parse(fs.readFileSync(installMetaPath, "utf8"));
    } catch {
      installMeta = {};
    }
  }

  const spritesheetPath = resolveSpritesheetFile(petDir);
  if (!spritesheetPath) return null;

  return {
    slug,
    displayName: installMeta.displayName || meta.displayName || meta.id || slug,
    description: meta.description || "",
    spritesheetUrl: installMeta.spritesheetUrl || "",
    kind: installMeta.kind || "creature",
    submittedBy: installMeta.submittedBy || meta.submittedBy || "",
    bundled: installMeta.bundled === true,
    source,
    spritesheetPath,
  };
}

export function copyBundledPet(slug) {
  const safeSlug = safePetSlug(slug);
  const bundledDir = path.join(getBundledPetsRoot(), safeSlug);
  const petJsonPath = path.join(bundledDir, "pet.json");
  if (!fs.existsSync(petJsonPath)) return false;

  const spritesheetPath = resolveSpritesheetFile(bundledDir);
  if (!spritesheetPath) return false;

  const petDir = path.join(getPetsRoot(), safeSlug);
  fs.mkdirSync(petDir, { recursive: true });
  fs.copyFileSync(petJsonPath, path.join(petDir, "pet.json"));

  const spritesheetName = path.basename(spritesheetPath);
  fs.copyFileSync(spritesheetPath, path.join(petDir, spritesheetName));

  const metaPath = path.join(bundledDir, "meta.json");
  if (fs.existsSync(metaPath)) {
    fs.copyFileSync(metaPath, path.join(petDir, "meta.json"));
  }

  return true;
}

export function writeInstalledPet({ slug, entry, petJson, spritesheet, extension }) {
  const safeSlug = safePetSlug(slug);
  const petDir = path.join(getPetsRoot(), safeSlug);
  fs.mkdirSync(petDir, { recursive: true });

  fs.writeFileSync(path.join(petDir, "pet.json"), petJson);
  const spritesheetPath = path.join(petDir, `spritesheet${extension}`);
  fs.writeFileSync(spritesheetPath, spritesheet);
  fs.writeFileSync(
    path.join(petDir, "meta.json"),
    JSON.stringify({
      slug: safeSlug,
      displayName: entry.displayName || safeSlug,
      spritesheetUrl: entry.spritesheetUrl,
      kind: entry.kind || "creature",
      submittedBy: entry.submittedBy || "",
    }),
  );

  return spritesheetPath;
}

export function listInstalledPets() {
  const bySlug = new Map();

  const scanRoot = (root, source) => {
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pet = readPetFromDir(path.join(root, entry.name), entry.name, source);
      if (pet) bySlug.set(pet.slug, pet);
    }
  };

  scanRoot(getPetsRoot(), "beru");
  scanRoot(getCodexPetsRoot(), "codex");

  return [...bySlug.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function resolveBundledSpritesheetFile(slug) {
  const safeSlug = safePetSlug(slug);
  return resolveSpritesheetFile(path.join(getBundledPetsRoot(), safeSlug));
}
