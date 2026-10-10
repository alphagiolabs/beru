import { describe, expect, it } from "vitest";
import { resolvePetState } from "../src/features/pets/utils/pet-states.js";

describe("pet-states", () => {
  it("falls back to idle for unknown states", () => {
    expect(resolvePetState("unknown-state").id).toBe("idle");
    expect(resolvePetState("running").row).toBe(7);
  });
});
