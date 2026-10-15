import { describe, expect, it } from "vitest";
import {
  SEEK_LIMIT_MS,
  SEEK_MIN_SAMPLES,
  SEEK_WINDOW,
  recordSeek,
  seekIsSlow,
} from "../src/features/editor/playback/proxy-policy.js";

describe("seek policy for the preview proxy", () => {
  it("says nothing until enough seeks have been timed", () => {
    expect(seekIsSlow(Array(SEEK_MIN_SAMPLES - 1).fill(900))).toBe(false);
  });

  it("switches a source whose 90th percentile seek is over the limit", () => {
    expect(seekIsSlow(Array(SEEK_MIN_SAMPLES).fill(SEEK_LIMIT_MS))).toBe(false);
    expect(seekIsSlow([...Array(SEEK_MIN_SAMPLES - 1).fill(100), SEEK_LIMIT_MS + 1])).toBe(true);
  });

  it("tolerates a few slow seeks among fast ones", () => {
    const mostlyFast = [...Array(11).fill(90), 400];
    expect(seekIsSlow(mostlyFast)).toBe(false);
    const oftenSlow = [...Array(10).fill(90), 400, 400];
    expect(seekIsSlow(oftenSlow)).toBe(true);
  });

  it("keeps only the most recent window of seeks", () => {
    let samples = [];
    for (let i = 0; i < SEEK_WINDOW + 5; i += 1) samples = recordSeek(samples, i);
    expect(samples).toHaveLength(SEEK_WINDOW);
    expect(samples[0]).toBe(5);
    expect(samples.at(-1)).toBe(SEEK_WINDOW + 4);
  });
});
