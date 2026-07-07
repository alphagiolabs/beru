import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PETDEX_MANIFEST_URL = "https://assets.petdex.dev/manifests/petdex-v1.json";
const PETDEX_REFERER = "https://petdex.dev/";

export function getPetsRoot() {
  return path.join(app.getPath("userData"), "pets");
}

export function getCodexPetsRoot() {
  return path.join(os.homedir(), ".codex", "pets");
}

export function getManifestCachePath() {
  return path.join(app.getPath("userData"), "pet-manifest.json");
}

export function getBundledPetsRoot() {
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

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("Demasiadas redirecciones"));
      return;
    }

    const parsed = new URL(url);
    const transport = parsed.protocol === "http:" ? httpRequest : httpsRequest;
    const req = transport(
      url,
      {
        headers: {
          Referer: PETDEX_REFERER,
          "User-Agent": "Beru/1.0",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          fetchBuffer(next, redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("error", reject);
  });
}

function readCachedManifest() {
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

export async function fetchPetManifest() {
  try {
    const raw = await fetchBuffer(PETDEX_MANIFEST_URL);
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!parsed || !Array.isArray(parsed.pets)) {
      throw new Error("Manifiesto de mascotas inválido");
    }
    fs.writeFileSync(getManifestCachePath(), raw);
    return { manifest: parsed, source: "remote" };
  } catch (error) {
    const cached = readCachedManifest();
    if (cached) return { manifest: cached, source: "cache" };
    const bundled = readBundledCatalog();
    if (bundled) return { manifest: bundled, source: "bundled" };
    throw error;
  }
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

function readPetFromDir(petDir, slug, source) {
  const petJsonPath = path.join(petDir, "pet.json");
  if (!fs.existsSync(petJsonPath)) return null;

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
    bundled: installMeta.bundled === true,
    source,
    spritesheetPath,
  };
}

function copyBundledPet(slug) {
  const bundledDir = path.join(getBundledPetsRoot(), slug);
  const petJsonPath = path.join(bundledDir, "pet.json");
  if (!fs.existsSync(petJsonPath)) return false;

  const spritesheetPath = resolveSpritesheetFile(bundledDir);
  if (!spritesheetPath) return false;

  const petDir = path.join(getPetsRoot(), slug);
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

export async function installPet(entry) {
  if (!entry?.slug) {
    throw new Error("Entrada de mascota inválida");
  }

  if (copyBundledPet(entry.slug)) {
    const installed = listInstalledPets().find((pet) => pet.slug === entry.slug);
    if (installed) return installed;
  }

  if (!entry?.petJsonUrl || !entry?.spritesheetUrl) {
    throw new Error("Mascota no disponible sin conexión");
  }

  const petDir = path.join(getPetsRoot(), entry.slug);
  fs.mkdirSync(petDir, { recursive: true });

  const petJson = await fetchBuffer(entry.petJsonUrl);
  fs.writeFileSync(path.join(petDir, "pet.json"), petJson);

  const ext = path.extname(new URL(entry.spritesheetUrl).pathname) || ".webp";
  const spritesheet = await fetchBuffer(entry.spritesheetUrl);
  fs.writeFileSync(path.join(petDir, `spritesheet${ext}`), spritesheet);
  fs.writeFileSync(
    path.join(petDir, "meta.json"),
    JSON.stringify({
      slug: entry.slug,
      displayName: entry.displayName || entry.slug,
      spritesheetUrl: entry.spritesheetUrl,
      kind: entry.kind || "creature",
    }),
  );

  return {
    slug: entry.slug,
    displayName: entry.displayName || entry.slug,
    description: entry.description || "",
    spritesheetUrl: entry.spritesheetUrl,
    kind: entry.kind || "creature",
    source: "beru",
    spritesheetPath: path.join(petDir, `spritesheet${ext}`),
  };
}

export function uninstallPet(slug) {
  const safeSlug = path.basename(String(slug || ""));
  if (!safeSlug || safeSlug !== slug) {
    throw new Error("Slug de mascota inválido");
  }

  const petDir = path.join(getPetsRoot(), safeSlug);
  if (!fs.existsSync(petDir)) {
    throw new Error("Mascota no instalada");
  }

  fs.rmSync(petDir, { recursive: true, force: true });
  return { slug: safeSlug };
}

export function resolvePetSpritesheetPath(slug) {
  const safeSlug = path.basename(String(slug || ""));
  if (!safeSlug || safeSlug !== slug) {
    throw new Error("Slug de mascota inválido");
  }

  const installed = listInstalledPets().find((pet) => pet.slug === safeSlug);
  if (installed?.spritesheetPath) return installed.spritesheetPath;

  const bundledDir = path.join(getBundledPetsRoot(), safeSlug);
  const bundledPath = resolveSpritesheetFile(bundledDir);
  if (bundledPath) return bundledPath;

  throw new Error("Spritesheet no encontrado");
}

export function resolveBundledSpritesheetPath(slug) {
  const safeSlug = path.basename(String(slug || ""));
  if (!safeSlug || safeSlug !== slug) {
    throw new Error("Slug de mascota inválido");
  }

  const bundledDir = path.join(getBundledPetsRoot(), safeSlug);
  const bundledPath = resolveSpritesheetFile(bundledDir);
  if (!bundledPath) {
    throw new Error("Spritesheet no encontrado");
  }
  return bundledPath;
}

export function isBundledPetAvailable(slug) {
  const bundledDir = path.join(getBundledPetsRoot(), slug);
  return fs.existsSync(path.join(bundledDir, "pet.json")) && !!resolveSpritesheetFile(bundledDir);
}
