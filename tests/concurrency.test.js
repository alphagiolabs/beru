import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "../main/utils/concurrency.js";

describe("runWithConcurrency", () => {
  it("handles empty input array", async () => {
    const results = await runWithConcurrency([], 2, async (item) => item);
    expect(results).toEqual([]);
  });

  it("respects concurrency limit when limit is smaller than items", async () => {
    let active = 0,
      maxActive = 0;
    const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return item * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("propagates worker errors", async () => {
    await expect(
      runWithConcurrency([1, 2], 2, async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");
  });

  it("passes item index to worker function", async () => {
    const indices = [];
    await runWithConcurrency([10, 20, 30], 2, async (item, idx) => {
      indices.push(idx);
      return item;
    });
    expect(indices.sort()).toEqual([0, 1, 2]);
  });

  it("stops scheduling after cancellation and retains in-flight results", async () => {
    let cancelled = false;
    const started = [];
    const release = [];
    const pending = runWithConcurrency(
      [1, 2, 3, 4],
      2,
      async (item) => {
        started.push(item);
        if (item <= 2) await new Promise((resolve) => release.push(resolve));
        return item * 10;
      },
      () => cancelled,
    );
    expect(started).toEqual([1, 2]);
    cancelled = true;
    release.forEach((resolve) => resolve());
    const results = await pending;
    expect(started).toEqual([1, 2]);
    expect(results.slice(0, 2)).toEqual([10, 20]);
    expect(results[2]).toBeUndefined();
    expect(results[3]).toBeUndefined();
  });
});
