import { describe, expect, it } from "vitest";
import {
  ATLAS_SHEET_HEIGHT,
  ATLAS_SHEET_WIDTH,
  defaultPetState,
  petStates,
  resolvePetState,
} from "../src/features/pets/utils/pet-states.js";

describe("pet-states", () => {
  it("exposes the canonical Petdex atlas dimensions", () => {
    expect(ATLAS_SHEET_WIDTH).toBe(1536);
    expect(ATLAS_SHEET_HEIGHT).toBe(1872);
  });

  it("defines nine animation rows", () => {
    expect(petStates).toHaveLength(9);
    expect(defaultPetState.id).toBe("idle");
  });

  it("falls back to idle for unknown states", () => {
    expect(resolvePetState("unknown-state").id).toBe("idle");
    expect(resolvePetState("running").row).toBe(7);
  });
});
