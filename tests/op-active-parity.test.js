import { describe, it, expect } from "vitest";
import { isOpActive } from "../src/components/video-preview/utils.js";

/**
 * Parity contract: `isOpActive` (preview) must agree with
 * `python/op_shared._build_enable_clause` (export) for every combination of
 * startTime/endTime. When the Python clause returns "" (no time filter), the
 * preview must consider the op active for every t.
 */
describe("isOpActive ↔ op_shared._build_enable_clause parity", () => {
  const cases = [
    { name: "no times → always active", op: {}, t: 10, expected: true },
    { name: "start only, t before start", op: { startTime: 5 }, t: 2, expected: false },
    { name: "start only, t at start", op: { startTime: 5 }, t: 5, expected: true },
    { name: "start only, t after start", op: { startTime: 5 }, t: 10, expected: true },
    { name: "end only, t before end", op: { endTime: 8 }, t: 2, expected: true },
    { name: "end only, t at end", op: { endTime: 8 }, t: 8, expected: true },
    { name: "end only, t after end", op: { endTime: 8 }, t: 12, expected: false },
    { name: "start<end, t in range", op: { startTime: 2, endTime: 8 }, t: 5, expected: true },
    { name: "start<end, t before range", op: { startTime: 2, endTime: 8 }, t: 1, expected: false },
    { name: "start<end, t after range", op: { startTime: 2, endTime: 8 }, t: 9, expected: false },
    // The regression case: end <= start. Empty/invalid range → op is disabled
    // in both export (build_filter_complex skips it) and preview (isOpActive
    // returns false for every t). The user's intent for start=10,end=5 is NOT
    // "apply always" — it's an invalid range.
    { name: "end<start, t before start", op: { startTime: 5, endTime: 2 }, t: 0, expected: false },
    { name: "end<start, t between", op: { startTime: 5, endTime: 2 }, t: 3, expected: false },
    { name: "end<start, t after end", op: { startTime: 5, endTime: 2 }, t: 10, expected: false },
    { name: "end==start, t at boundary", op: { startTime: 5, endTime: 5 }, t: 5, expected: false },
    { name: "end==start, t before", op: { startTime: 5, endTime: 5 }, t: 2, expected: false },
    { name: "end==start, t after", op: { startTime: 5, endTime: 5 }, t: 8, expected: false },
  ];

  for (const c of cases) {
    it(`${c.name} → ${c.expected ? "active" : "inactive"}`, () => {
      expect(isOpActive(c.op, c.t)).toBe(c.expected);
    });
  }
});
