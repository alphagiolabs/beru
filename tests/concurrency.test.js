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
});
