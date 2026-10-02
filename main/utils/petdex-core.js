import path from "path";

export const PETDEX_MANIFEST_URL = "https://assets.petdex.dev/manifests/petdex-v1.json";
export const PETDEX_REFERER = "https://petdex.dev/";
export const PETDEX_MAX_BODY_BYTES = 5 * 1024 * 1024;

const PETDEX_ALLOWED_HOSTS = new Set(["assets.petdex.dev"]);
const PETDEX_SPRITESHEET_EXTENSIONS = new Set([".webp", ".png", ".gif"]);

export function safePetSlug(slug) {
  const safeSlug = path.basename(String(slug || ""));
  if (!safeSlug || safeSlug !== slug) {
    throw new Error("Slug de mascota inválido");
  }
  return safeSlug;
}

export function assertPetdexUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    throw new Error("URL de mascota inválida");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("URL de mascota inválida");
  }

  if (!PETDEX_ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error("Host de mascota no permitido");
  }

  return parsed;
}

export function assertPetdexBodySize(byteLength, maxBytes = PETDEX_MAX_BODY_BYTES) {
  if (byteLength > maxBytes) {
    throw new Error("Respuesta demasiado grande");
  }
}

export function normalizeManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.pets)) {
    return { total: 0, pets: [] };
  }

  const pets = manifest.pets
    .map((entry) => ({
      slug: String(entry?.slug || "").trim(),
      displayName: String(entry?.displayName || entry?.slug || "").trim(),
      kind: String(entry?.kind || "creature").trim() || "creature",
      submittedBy: String(entry?.submittedBy || "").trim(),
      spritesheetUrl: String(entry?.spritesheetUrl || "").trim(),
      petJsonUrl: String(entry?.petJsonUrl || "").trim(),
      zipUrl: String(entry?.zipUrl || "").trim(),
    }))
    .filter((entry) => entry.slug && entry.spritesheetUrl && entry.petJsonUrl);

  return {
    generatedAt: manifest.generatedAt || null,
    total: pets.length,
    pets,
  };
}

export function parsePetManifest(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.pets)) {
    throw new Error("Manifiesto de mascotas inválido");
  }
  const manifest = normalizeManifest(parsed);
  if (!manifest.pets.length) {
    throw new Error("Manifiesto de mascotas vacío");
  }
  return manifest;
}

export function petSpritesheetExtension(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return PETDEX_SPRITESHEET_EXTENSIONS.has(ext) ? ext : ".webp";
}
