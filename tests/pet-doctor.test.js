import { describe, expect, it } from "vitest";
import { diagnosePetSetup } from "../src/features/pets/utils/pet-doctor.js";

describe("pet-doctor", () => {
  it("reports ready when pet is enabled, selected, and loaded", () => {
    const result = diagnosePetSetup({
      petEnabled: true,
      petActiveSlug: "boba",
      petInstalled: [{ slug: "boba" }],
      petSpritesheet: "beru://local/boba.webp",
      petManifestError: null,
    });
    expect(result.ready).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("flags missing installs and spritesheets", () => {
    const result = diagnosePetSetup({
      petEnabled: true,
      petActiveSlug: "boba",
      petInstalled: [],
      petSpritesheet: null,
      petManifestError: "offline",
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContain("no-installed");
    expect(result.issues).toContain("spritesheet-missing");
    expect(result.issues).toContain("gallery-offline");
  });
});
