import {
  normalizeManifest,
  parsePetManifest,
  petSpritesheetExtension,
  safePetSlug,
  PETDEX_MANIFEST_URL,
} from "./petdex-core.js";
import {
  copyBundledPet,
  listInstalledPets,
  readBundledCatalog,
  readCachedManifest,
  resolveBundledSpritesheetFile,
  writeInstalledPet,
  writeManifestCache,
} from "./petdex-fs.js";
import { fetchPetBuffer } from "./petdex-https.js";

export async function fetchPetManifest() {
  try {
    const raw = await fetchPetBuffer(PETDEX_MANIFEST_URL);
    const manifest = parsePetManifest(raw.toString("utf8"));
    writeManifestCache(manifest);
    return { manifest, source: "remote" };
  } catch (error) {
    const cached = readCachedManifest();
    if (cached) return { manifest: normalizeManifest(cached), source: "cache" };
    const bundled = readBundledCatalog();
    if (bundled) return { manifest: normalizeManifest(bundled), source: "bundled" };
    throw error;
  }
}

export async function installPet(entry) {
  if (!entry?.slug) {
    throw new Error("Entrada de mascota inválida");
  }

  const safeSlug = safePetSlug(entry.slug);

  const alreadyInstalled = listInstalledPets().find((pet) => pet.slug === safeSlug);
  if (alreadyInstalled) return alreadyInstalled;

  if (copyBundledPet(safeSlug)) {
    const installed = listInstalledPets().find((pet) => pet.slug === safeSlug);
    if (installed) return installed;
  }

  if (!entry?.petJsonUrl || !entry?.spritesheetUrl) {
    throw new Error("Mascota no disponible sin conexión");
  }

  const petJson = await fetchPetBuffer(entry.petJsonUrl);
  const extension = petSpritesheetExtension(entry.spritesheetUrl);
  const spritesheet = await fetchPetBuffer(entry.spritesheetUrl);
  const spritesheetPath = writeInstalledPet({
    slug: safeSlug,
    entry,
    petJson,
    spritesheet,
    extension,
  });

  return {
    slug: safeSlug,
    displayName: entry.displayName || safeSlug,
    description: entry.description || "",
    spritesheetUrl: entry.spritesheetUrl,
    kind: entry.kind || "creature",
    submittedBy: entry.submittedBy || "",
    source: "beru",
    spritesheetPath,
  };
}

export function resolvePetSpritesheetPath(slug) {
  const safeSlug = safePetSlug(slug);

  const installed = listInstalledPets().find((pet) => pet.slug === safeSlug);
  if (installed?.spritesheetPath) return installed.spritesheetPath;

  const bundledPath = resolveBundledSpritesheetFile(safeSlug);
  if (bundledPath) return bundledPath;

  throw new Error("Spritesheet no encontrado");
}

export function resolveBundledSpritesheetPath(slug) {
  const bundledPath = resolveBundledSpritesheetFile(slug);
  if (!bundledPath) {
    throw new Error("Spritesheet no encontrado");
  }
  return bundledPath;
}
