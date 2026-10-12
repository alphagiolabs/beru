import { describe, expect, it } from "vitest";
import {
  normalizeBatchWorkers,
  normalizeBatchWorkersMode,
  normalizeEncodeProfile,
} from "../src/utils/processing-settings.js";

describe("processing settings normalizers", () => {
  it("keeps known encode profiles and falls back to balanced", () => {
    for (const profile of ["fast", "balanced", "quality", "uquality"]) {
      expect(normalizeEncodeProfile(profile)).toBe(profile);
    }
    expect(normalizeEncodeProfile("ultra")).toBe("balanced");
    expect(normalizeEncodeProfile(undefined)).toBe("balanced");
  });

  it("clamps batch workers to 0..16 integers", () => {
    expect(normalizeBatchWorkers(4.9)).toBe(4);
    expect(normalizeBatchWorkers("8")).toBe(8);
    expect(normalizeBatchWorkers(99)).toBe(16);
    expect(normalizeBatchWorkers(-3)).toBe(0);
    expect(normalizeBatchWorkers("x")).toBe(0);
    expect(normalizeBatchWorkers(undefined)).toBe(0);
  });

  it("only accepts conservative as an alternative worker mode", () => {
    expect(normalizeBatchWorkersMode("conservative")).toBe("conservative");
    expect(normalizeBatchWorkersMode("aggressive")).toBe("balanced");
  });
});
