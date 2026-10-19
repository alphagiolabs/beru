import { describe, expect, it } from "vitest";
import { recordSeek, seekIsSlow } from "../src/features/editor/playback/proxy-policy.js";

describe("seek policy for the preview proxy", () => {
  it("says nothing until enough seeks have been timed", () => {
    expect(seekIsSlow(Array(7).fill(900))).toBe(false);
  });

  it("switches a source whose 90th percentile seek is over the limit", () => {
    expect(seekIsSlow(Array(8).fill(150))).toBe(false);
    expect(seekIsSlow([...Array(7).fill(100), 151])).toBe(true);
  });

  it("tolerates a few slow seeks among fast ones", () => {
    const mostlyFast = [...Array(11).fill(90), 400];
    expect(seekIsSlow(mostlyFast)).toBe(false);
    const oftenSlow = [...Array(10).fill(90), 400, 400];
    expect(seekIsSlow(oftenSlow)).toBe(true);
  });

  it("keeps only the most recent window of seeks", () => {
    let samples = [];
    for (let i = 0; i < 17; i += 1) samples = recordSeek(samples, i);
    expect(samples).toHaveLength(12);
    expect(samples[0]).toBe(5);
    expect(samples.at(-1)).toBe(16);
  });
});
