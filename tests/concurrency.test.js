import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "../main/utils/concurrency.js";

describe("runWithConcurrency", () => {
  it("keeps result order and uses per-item fallback when a worker fails", async () => {
    const results = await runWithConcurrency(
      [1, 2, 3],
      2,
      async (item) => {
        if (item === 2) throw new Error("bad item");
        return item * 10;
      },
      (err, item) => ({ item, error: err.message }),
    );

    expect(results).toEqual([10, { item: 2, error: "bad item" }, 30]);
  });

  it("handles empty input array", async () => {
    const results = await runWithConcurrency([], 2, async (item) => item);
    expect(results).toEqual([]);
  });

  it("respects concurrency limit when limit is smaller than items", async () => {
    let active = 0,
      maxActive = 0;
    const results = await runWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (item) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return item * 2;
      },
    );
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("throws error when no fallback is provided and a worker fails", async () => {
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

  it("passes item index to fallback function", async () => {
    const results = await runWithConcurrency(
      [1, 2],
      2,
      async (item) => {
        throw new Error("fail");
      },
      (err, item, idx) => idx,
    );
    expect(results).toEqual([0, 1]);
  });
});
