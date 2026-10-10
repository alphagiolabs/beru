import os from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMediaTaskPool } from "../main/utils/media-task-pool.js";

const FAT_MEMORY = { freeMemoryMb: () => 8192 };

const blockingTask = (release) => () => new Promise((resolve) => release.push(resolve));

describe("media task pool", () => {
  beforeEach(() => {
    vi.spyOn(os, "freemem").mockReturnValue(8 * 1024 ** 3);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("removes cancelled queued work and admits a replacement without waiting for the old task", async () => {
    const pool = createMediaTaskPool({ maxActive: 1, maxQueuedTasks: 1, ...FAT_MEMORY });
    let finish;
    const blocker = pool.run(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    const controller = new AbortController();
    const cancelledTask = vi.fn();
    const queued = pool.run(cancelledTask, { key: "strip", signal: controller.signal });
    const rejection = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    const replacement = pool.run(() => "new", { key: "strip" });
    finish();
    await blocker;
    expect(await replacement).toBe("new");
    expect(cancelledTask).not.toHaveBeenCalled();
    expect(await pool.run(() => "later", { key: "strip" })).toBe("later");
  });
  it("reduces admission under pressure, then uses recovered memory without killing active work", async () => {
    const pool = createMediaTaskPool({ maxActive: 8 });
    const free = vi.spyOn(os, "freemem");
    free.mockReturnValue(1536 * 1024 ** 2);
    let active = 0;
    const release = [];
    const tasks = Array.from({ length: 10 }, () =>
      pool.run(
        () =>
          new Promise((resolve) => {
            active++;
            release.push(() => {
              active--;
              resolve();
            });
          }),
      ),
    );
    await vi.waitFor(() => expect(active).toBe(4));
    free.mockReturnValue(256 * 1024 ** 2);
    release.splice(0, 3).forEach((finish) => finish());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(active).toBe(1);
    expect(release).toHaveLength(1);
    free.mockReturnValue(8 * 1024 ** 3);
    release.shift()();
    await vi.waitFor(() => expect(active).toBeGreaterThan(1));
    release.splice(0).forEach((finish) => finish());
    await Promise.all(tasks);
    expect(active).toBe(0);
  });

  it("promotes one pending thumbnail ahead of background work while preserving selected-video priority", async () => {
    const pool = createMediaTaskPool({ maxActive: 1 });
    vi.spyOn(os, "freemem").mockReturnValue(256 * 1024 ** 2);
    let finish;
    const blocker = pool.run(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    const order = [];
    const background = pool.run(() => {
      order.push("background");
      return "background";
    });
    const thumb = pool.run(
      () => {
        order.push("thumbnail");
        return "jpeg";
      },
      { key: "thumbnail:visible" },
    );
    const promoted = pool.run(
      () => {
        throw new Error("duplicate thumbnail");
      },
      { key: "thumbnail:visible", visible: true },
    );
    const selected = pool.run(
      () => {
        order.push("selected");
        return "selected";
      },
      { interactive: true },
    );
    const metadata = pool.run(
      () => {
        order.push("metadata");
        return "metadata";
      },
      { metadata: true, memoryMb: 32 },
    );
    finish();
    await expect(
      Promise.all([blocker, background, thumb, promoted, selected, metadata]),
    ).resolves.toEqual([undefined, "background", "jpeg", "jpeg", "selected", "metadata"]);
    expect(order).toEqual(["selected", "thumbnail", "metadata", "background"]);
  });

  it("lets a failed keyed job be retried and makes progress when memory cannot be read", async () => {
    const pool = createMediaTaskPool({ maxActive: 1 });
    vi.spyOn(os, "freemem").mockReturnValue(Number.NaN);
    await expect(
      pool.run(
        () => {
          throw new Error("decode failed");
        },
        { key: "retry" },
      ),
    ).rejects.toThrow("decode failed");
    await expect(pool.run(() => "recovered", { key: "retry" })).resolves.toBe("recovered");
  });
});

describe("createMediaTaskPool", () => {
  it("admits lightweight probes alongside a thumbnail without exceeding the memory budget", async () => {
    const pool = createMediaTaskPool({ maxActive: 8, freeMemoryMb: () => 1024 });
    const heavyRelease = [];
    const lightRelease = [];
    const first = pool.run(blockingTask(heavyRelease));
    const probes = Array.from({ length: 5 }, () =>
      pool.run(blockingTask(lightRelease), { memoryMb: 32 }),
    );
    const second = pool.run(blockingTask(heavyRelease), { visible: true });
    await Promise.resolve();
    expect(heavyRelease).toHaveLength(1);
    expect(lightRelease).toHaveLength(5);
    lightRelease.forEach((finish) => finish());
    await Promise.all(probes);
    await vi.waitFor(() => expect(heavyRelease).toHaveLength(2));
    heavyRelease.forEach((finish) => finish());
    await Promise.all([first, second]);
  });

  it("caps concurrency at the configured maxActive", async () => {
    const pool = createMediaTaskPool({ maxActive: 3, ...FAT_MEMORY });
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, (_, index) =>
      pool.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return index;
      }),
    );

    await expect(Promise.all(tasks)).resolves.toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(peak).toBe(3);
  });

  it("squeezes capacity to processingCapacity while a run is active", async () => {
    const pool = createMediaTaskPool({ maxActive: 6, processingCapacity: 1, ...FAT_MEMORY });
    pool.setProcessingActive(true);
    let active = 0;
    let peak = 0;
    try {
      await Promise.all(
        Array.from({ length: 6 }, () =>
          pool.run(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 10));
            active -= 1;
          }),
        ),
      );
      expect(peak).toBe(1);
    } finally {
      pool.setProcessingActive(false);
    }
  });

  it("waits for drain until active work fits the processing capacity", async () => {
    const pool = createMediaTaskPool({ maxActive: 3, processingCapacity: 1, ...FAT_MEMORY });
    const release = [];
    const tasks = Array.from({ length: 3 }, () => pool.run(blockingTask(release)));
    await Promise.resolve();
    expect(release).toHaveLength(3);

    pool.setProcessingActive(true);
    let drained = false;
    const ready = pool.waitForDrain().then(() => {
      drained = true;
    });

    release.shift()();
    await Promise.resolve();
    await Promise.resolve();
    expect(drained).toBe(false);

    release.shift()();
    await ready;
    expect(drained).toBe(true);

    release.forEach((finish) => finish());
    await Promise.all(tasks);
    pool.setProcessingActive(false);
  });

  it("rejects admission once a queue hits the configured depth", async () => {
    const pool = createMediaTaskPool({ maxActive: 1, maxQueuedTasks: 2, ...FAT_MEMORY });
    const release = [];
    const blocker = pool.run(blockingTask(release));
    await Promise.resolve();

    const queued = [pool.run(() => "a"), pool.run(() => "b")];
    await expect(pool.run(() => "late")).rejects.toThrow("Demasiadas tareas de medios en cola");

    release.forEach((finish) => finish());
    await expect(Promise.all([blocker, ...queued])).resolves.toEqual([undefined, "a", "b"]);
    await expect(pool.run(() => "after")).resolves.toBe("after");
  });

  it("shares active keyed work without executing a duplicate task", async () => {
    const pool = createMediaTaskPool({ maxActive: 1, ...FAT_MEMORY });
    const release = [];
    const pending = pool.run(blockingTask(release), { key: "k" });
    await Promise.resolve();

    const duplicateTask = vi.fn(() => "duplicate");
    const duplicate = pool.run(duplicateTask, { key: "k" });

    release.forEach((finish) => finish("original"));
    await expect(Promise.all([pending, duplicate])).resolves.toEqual(["original", "original"]);
    expect(duplicateTask).not.toHaveBeenCalled();
  });

  it("keeps queues and flags isolated between pools", async () => {
    const first = createMediaTaskPool({ maxActive: 1, ...FAT_MEMORY });
    const second = createMediaTaskPool({ maxActive: 1, ...FAT_MEMORY });
    const release = [];
    const blocker = first.run(blockingTask(release));
    const queued = first.run(() => "queued");
    first.setProcessingActive(true);

    await expect(second.run(() => "isolated")).resolves.toBe("isolated");

    release.forEach((finish) => finish());
    await expect(Promise.all([blocker, queued])).resolves.toEqual([undefined, "queued"]);
  });
});
