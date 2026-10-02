import { describe, expect, it } from "vitest";
import {
  assertPetdexBodySize,
  assertPetdexUrl,
  normalizeManifest,
  parsePetManifest,
  petSpritesheetExtension,
  safePetSlug,
  PETDEX_MAX_BODY_BYTES,
} from "../main/utils/petdex-core.js";

describe("petdex-core", () => {
  it("normalizes remote manifest entries", () => {
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

  it("returns an empty manifest for malformed input", () => {
    expect(normalizeManifest(null)).toEqual({ total: 0, pets: [] });
    expect(normalizeManifest({ pets: "nope" })).toEqual({ total: 0, pets: [] });
  });

  it("parses manifest payloads and rejects invalid shapes", () => {
    const manifest = parsePetManifest(
      JSON.stringify({
        pets: [
          {
            slug: "boba",
            spritesheetUrl: "https://assets.petdex.dev/curated/boba/spritesheet.webp",
            petJsonUrl: "https://assets.petdex.dev/curated/boba/pet.json",
          },
        ],
      }),
    );
    expect(manifest.pets).toHaveLength(1);

    expect(() => parsePetManifest("{}")).toThrow("Manifiesto de mascotas inválido");
    expect(() => parsePetManifest(JSON.stringify({ pets: [] }))).toThrow(
      "Manifiesto de mascotas vacío",
    );
    expect(() => parsePetManifest("not json")).toThrow(SyntaxError);
  });

  it("rejects unsafe petdex URLs", () => {
    expect(() => assertPetdexUrl("http://assets.petdex.dev/curated/boba/pet.json")).toThrow(
      /URL de mascota inválida/,
    );
    expect(() => assertPetdexUrl("https://evil.example/curated/boba/pet.json")).toThrow(
      /Host de mascota no permitido/,
    );
    expect(() => assertPetdexUrl("not a url")).toThrow(/URL de mascota inválida/);
    expect(() => assertPetdexUrl("https://assets.petdex.dev/curated/boba/pet.json")).not.toThrow();
  });

  it("rejects path-traversal slugs", () => {
    expect(() => safePetSlug("../evil")).toThrow(/Slug de mascota inválido/);
    expect(() => safePetSlug("")).toThrow(/Slug de mascota inválido/);
    expect(safePetSlug("boba")).toBe("boba");
  });

  it("rejects oversize petdex bodies", () => {
    expect(() => assertPetdexBodySize(PETDEX_MAX_BODY_BYTES)).not.toThrow();
    expect(() => assertPetdexBodySize(PETDEX_MAX_BODY_BYTES + 1)).toThrow(
      /Respuesta demasiado grande/,
    );
  });

  it("restricts spritesheet downloads to image extensions", () => {
    expect(petSpritesheetExtension("https://assets.petdex.dev/x/sheet.png")).toBe(".png");
    expect(petSpritesheetExtension("https://assets.petdex.dev/x/sheet.gif")).toBe(".gif");
    expect(petSpritesheetExtension("https://assets.petdex.dev/x/sheet.webp")).toBe(".webp");
    expect(petSpritesheetExtension("https://assets.petdex.dev/x/sheet.exe")).toBe(".webp");
    expect(petSpritesheetExtension("https://assets.petdex.dev/x/sheet")).toBe(".webp");
  });
});
