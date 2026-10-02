import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThumbnailDiskCache } from "../main/utils/thumbnail-disk-cache.js";

const thumbnail = {
  dataUrl: "data:image/jpeg;base64,Zmlyc3Q=",
  width: 80,
  height: 46,
  size: 5,
};

describe("persistent thumbnail storage", () => {
  let directory;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "beru-thumb-disk-"));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const cache = (options = {}) => createThumbnailDiskCache({ directory, ...options });

  it("restores images and dimensions from a fresh cache instance without leaving partial files", async () => {
    await cache().set("video", thumbnail);
    expect(await cache().get("video")).toEqual(thumbnail);
    expect(await cache().get("other-video")).toBeNull();
    expect((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["invalid-json", "changed-image"])(
    "treats %s as a cache miss and permits repair",
    async (damage) => {
      await cache().set("video", thumbnail);
      const file = path.join(directory, (await fs.readdir(directory))[0]);
      if (damage === "invalid-json") await fs.writeFile(file, "{");
      else {
        const envelope = JSON.parse(await fs.readFile(file, "utf8"));
        envelope.result.dataUrl += "tampered";
        await fs.writeFile(file, JSON.stringify(envelope));
      }
      const restored = cache();
      expect(await restored.get("video")).toBeNull();
      await restored.set("video", thumbnail);
      expect(await cache().get("video")).toEqual(thumbnail);
    },
  );

  it("evicts the least recently used image when the entry limit is reached", async () => {
    const initial = cache();
    await initial.set("a", thumbnail);
    await initial.set("b", thumbnail);
    const old = new Date(Date.now() - 10000);
    await Promise.all(
      (await fs.readdir(directory)).map((name) => fs.utimes(path.join(directory, name), old, old)),
    );
    const bounded = cache({ maxEntries: 2 });
    expect(await bounded.get("a")).toEqual(thumbnail);
    await bounded.set("c", thumbnail);
    expect(await bounded.get("b")).toBeNull();
    expect(await bounded.get("a")).toEqual(thumbnail);
    expect(await bounded.get("c")).toEqual(thumbnail);
    expect(await fs.readdir(directory)).toHaveLength(2);
  });

  it("keeps persisted bytes within budget and skips an entry that cannot fit", async () => {
    await cache().set("a", thumbnail);
    const size = (await fs.stat(path.join(directory, (await fs.readdir(directory))[0]))).size;
    const bounded = cache({ maxBytes: size + 1 });
    await bounded.set("b", thumbnail);
    expect(await bounded.get("a")).toBeNull();
    expect(await bounded.get("b")).toEqual(thumbnail);
    await bounded.set("large", { ...thumbnail, dataUrl: thumbnail.dataUrl.repeat(100) });
    expect(await bounded.get("large")).toBeNull();
    const sizes = await Promise.all(
      (await fs.readdir(directory)).map(
        async (name) => (await fs.stat(path.join(directory, name))).size,
      ),
    );
    expect(sizes.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThanOrEqual(size + 1);
  });

  it("expires unused images without deleting unrelated files in the directory", async () => {
    await cache().set("video", thumbnail);
    const file = path.join(directory, (await fs.readdir(directory))[0]);
    const old = new Date(Date.now() - 10000);
    await fs.utimes(file, old, old);
    await fs.writeFile(path.join(directory, "keep.txt"), "unrelated");
    expect(await cache({ maxAgeMs: 1000 }).get("video")).toBeNull();
    expect(await fs.readFile(path.join(directory, "keep.txt"), "utf8")).toBe("unrelated");
    expect(await fs.readdir(directory)).toEqual(["keep.txt"]);
  });

  it("fails open when storage is unavailable", async () => {
    const blocked = path.join(directory, "file-not-directory");
    await fs.writeFile(blocked, "existing-file");
    const unavailable = createThumbnailDiskCache({ directory: blocked });
    expect(await unavailable.get("video")).toBeNull();
    await expect(unavailable.set("video", thumbnail)).resolves.toBeNull();
    expect(await fs.readFile(blocked, "utf8")).toBe("existing-file");
  });
});
