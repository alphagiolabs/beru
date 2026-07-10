import { describe, expect, it } from "vitest";
import {
  celebrationDurationMs,
  petBubbleKey,
  resolveBatchCelebration,
  resolvePetActivity,
} from "../src/features/pets/utils/pet-activity.js";

describe("pet-activity", () => {
  it("maps Beru activity to Hermes-style pet states", () => {
    expect(resolvePetActivity({ isProcessing: true })).toBe("running");
    expect(resolvePetActivity({ confirmOpen: true })).toBe("waiting");
    expect(resolvePetActivity({ updateDownloading: true })).toBe("review");
    expect(resolvePetActivity({ celebration: "jumping" })).toBe("jumping");
    expect(resolvePetActivity({})).toBe("idle");
  });

  it("derives celebration states from batch summaries", () => {
    expect(resolveBatchCelebration({ total: 3, succeeded: 3, failed: 0 })).toBe("jumping");
    expect(resolveBatchCelebration({ total: 3, succeeded: 2, failed: 1 })).toBe("failed");
    expect(resolveBatchCelebration({ total: 2, succeeded: 1, failed: 0 })).toBe("waving");
    expect(resolveBatchCelebration({ total: 1, succeeded: 1, failed: 0 })).toBe("jumping");
    expect(resolveBatchCelebration(null)).toBeNull();
  });

  it("exposes bubble keys and celebration durations", () => {
    expect(petBubbleKey("running")).toBe("settings.petdex.bubbleWorking");
    expect(petBubbleKey("waiting")).toBe("settings.petdex.bubbleYourTurn");
    expect(celebrationDurationMs("jumping")).toBeGreaterThan(2000);
  });
});
