import fs from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";

const MAX_ENTRY_BYTES = 6 * 1024 * 1024;
const ENTRY_NAME = /^[a-f0-9]{64}\.json$/;
const TEMP_NAME = /^[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/;
const checksum = (value) => createHash("sha256").update(value).digest("hex");

export function createThumbnailDiskCache({
  directory,
  maxBytes = 64 * 1024 * 1024,
  maxEntries = 2000,
  maxAgeMs = 30 * 24 * 60 * 60 * 1000,
}) {
  const entries = new Map();
  let initialized;
  let queue = Promise.resolve();

  async function remove(name) {
    await fs.unlink(path.join(directory, name)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    entries.delete(name);
  }

  async function prune(reserveBytes = 0, reserveName) {
    const ordered = [...entries]
      .filter(([name]) => name !== reserveName)
      .sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
    let bytes = reserveBytes;
    let count = reserveName ? 1 : 0;
    const cutoff = Date.now() - maxAgeMs;
    for (const [name, entry] of ordered) {
      if (
        entry.mtimeMs < cutoff ||
        entry.size > MAX_ENTRY_BYTES ||
        count >= maxEntries ||
        bytes + entry.size > maxBytes
      ) {
        await remove(name);
      } else {
        bytes += entry.size;
        count++;
      }
    }
  }

  async function initialize() {
    await fs.mkdir(directory, { recursive: true });
    const files = await fs.readdir(directory, { withFileTypes: true });
    await Promise.all(
      files
        .filter((file) => file.isFile())
        .map(async (file) => {
          if (!ENTRY_NAME.test(file.name) && !TEMP_NAME.test(file.name)) return;
          const stat = await fs.stat(path.join(directory, file.name)).catch(() => null);
          if (!stat) return;
          if (ENTRY_NAME.test(file.name)) entries.set(file.name, stat);
          else if (stat.mtimeMs < Date.now() - 24 * 60 * 60 * 1000) await remove(file.name);
        }),
    );
    await prune();
  }

  function run(task) {
    const result = queue.then(async () => {
      initialized ||= initialize();
      await initialized;
      return task();
    });
    queue = result.catch(() => {});
    return result.catch(() => null);
  }

  return {
    get(key) {
      return run(async () => {
        const name = `${checksum(key)}.json`;
        if (!entries.has(name)) return null;
        try {
          const stat = await fs.stat(path.join(directory, name));
          if (stat.size > MAX_ENTRY_BYTES || stat.mtimeMs < Date.now() - maxAgeMs) {
            await remove(name);
            return null;
          }
          const envelope = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
          const result = envelope.result;
          if (
            !result?.dataUrl?.startsWith("data:image/jpeg;base64,") ||
            !(result.width > 0) ||
            !(result.height > 0) ||
            !(result.size > 0) ||
            envelope.checksum !== checksum(JSON.stringify(result))
          ) {
            await remove(name);
            return null;
          }
          const now = new Date();
          await fs.utimes(path.join(directory, name), now, now);
          entries.set(name, { size: stat.size, mtimeMs: now.getTime() });
          return result;
        } catch {
          await remove(name);
          return null;
        }
      });
    },

    set(key, result) {
      return run(async () => {
        const hash = checksum(key);
        const name = `${hash}.json`;
        const data = JSON.stringify({ result, checksum: checksum(JSON.stringify(result)) });
        const size = Buffer.byteLength(data);
        if (
          size > MAX_ENTRY_BYTES ||
          size > maxBytes ||
          !(result?.width > 0) ||
          !(result.height > 0)
        )
          return;
        await prune(size, name);
        const temporary = path.join(directory, `${hash}.${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, data, { flag: "wx" });
          await fs.rename(temporary, path.join(directory, name));
          entries.set(name, { size, mtimeMs: Date.now() });
          await prune();
        } finally {
          await fs.unlink(temporary).catch(() => {});
        }
      });
    },
  };
}
