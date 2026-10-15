import { describe, it, expect } from "vitest";
import limits from "../resources/processing-limits.json" with { type: "json" };
import { COMPOSITION_LIMITS } from "../shared/composition-settings.js";
import {
  IDENTITY_TIMING,
  MIN_RATE,
  MAX_RATE,
  MIN_REPEAT_COUNT,
  MAX_REPEAT_COUNT,
  MAX_OUTPUT_DURATION,
  normalizeTiming,
} from "../shared/clip-timeline.js";

describe("processing limits contract (JSON)", () => {
  it("is versioned", () => {
    expect(limits.version).toBe(1);
  });
});

describe("processing limits (JS parity)", () => {
  it("uses the same timing limits for Batch and Editor compositions", () => {
    expect(COMPOSITION_LIMITS).toMatchObject({
      minRate: limits.min_rate,
      maxRate: limits.max_rate,
      minRepeatCount: limits.min_repeat_count,
      maxRepeatCount: limits.max_repeat_count,
      maxDurationSeconds: limits.max_output_duration_seconds,
    });
  });

  it("clip-timeline constants match resources/processing-limits.json", () => {
    expect(MIN_RATE).toBe(limits.min_rate);
    expect(MAX_RATE).toBe(limits.max_rate);
    expect(MIN_REPEAT_COUNT).toBe(limits.min_repeat_count);
    expect(MAX_REPEAT_COUNT).toBe(limits.max_repeat_count);
    expect(MAX_OUTPUT_DURATION).toBe(limits.max_output_duration_seconds);
  });

  it("accepts values at the limits", () => {
    expect(
      normalizeTiming({ rate: limits.min_rate, repeatCount: limits.min_repeat_count }),
    ).toEqual({ rate: limits.min_rate, repeatCount: limits.min_repeat_count });
    expect(
      normalizeTiming({ rate: limits.max_rate, repeatCount: limits.max_repeat_count }),
    ).toEqual({ rate: limits.max_rate, repeatCount: limits.max_repeat_count });
  });

  it("falls back to identity outside the limits instead of clamping", () => {
    expect(normalizeTiming({ rate: 0.24, repeatCount: 1 })).toEqual(IDENTITY_TIMING);
    expect(normalizeTiming({ rate: 4.1, repeatCount: 1 })).toEqual(IDENTITY_TIMING);
    expect(normalizeTiming({ rate: 1, repeatCount: 21 })).toEqual(IDENTITY_TIMING);
  });
});
