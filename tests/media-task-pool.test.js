import { describe, expect, it } from "vitest";
import { runMediaTask, setMediaProcessingActive } from "../main/utils/media-task-pool.js";

describe("media task pool", () => {
  it("caps concurrently running multimedia tasks", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, (_, index) =>
      runMediaTask(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return index;
      }),
    );

    await expect(Promise.all(tasks)).resolves.toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(peak).toBeLessThanOrEqual(8);
  });

  it("reserves resources for an active export", async () => {
    setMediaProcessingActive(true);
    let active = 0;
    let peak = 0;
    try {
      await Promise.all(
        Array.from({ length: 6 }, () =>
          runMediaTask(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 10));
            active -= 1;
          }),
        ),
      );
      expect(peak).toBeLessThanOrEqual(2);
    } finally {
      setMediaProcessingActive(false);
    }
  });
});
