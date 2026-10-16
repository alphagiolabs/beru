import fs from "fs";
import path from "path";

const TEMP_DIR_PREFIX = "beru-jobs-";
const ORPHAN_PREFIXES = [TEMP_DIR_PREFIX, "beru-temporal-", "beru-preview-"];
const MANIFEST_NAME = "manifest.json";
const OWNER_MARKER = "owner.json";

const sentinelPathFor = (manifestPath) => {
  const { dir, name } = path.parse(manifestPath);
  return path.join(dir, `${name}.cancel`);
};

export async function createCancelArtifacts(tempRoot) {
  const dir = await fs.promises.mkdtemp(path.join(tempRoot, TEMP_DIR_PREFIX));
  try {
    fs.writeFileSync(path.join(dir, OWNER_MARKER), JSON.stringify({ pid: process.pid }));
  } catch (err) {
    console.error("[beru] scratch ownership marker could not be written:", err.message);
  }
  const manifestPath = path.join(dir, MANIFEST_NAME);
  const cancelPath = sentinelPathFor(manifestPath);
  return {
    manifestPath,
    markCancelled() {
      try {
        fs.writeFileSync(cancelPath, "1");
      } catch (err) {
        console.error("[beru] cancellation signal could not be written:", err.message);
      }
    },
    isCancelled() {
      return fs.existsSync(cancelPath);
    },
    dispose() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

const defaultIsPidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readOwnerPid = (target) => {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(target, OWNER_MARKER), "utf8"));
    return Number.isInteger(marker?.pid) ? marker.pid : null;
  } catch {
    return null;
  }
};

export function sweepOrphanedArtifacts(tempRoot, { isPidAlive = defaultIsPidAlive } = {}) {
  try {
    for (const entry of fs.readdirSync(tempRoot, { withFileTypes: true })) {
      if (!ORPHAN_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
      const target = path.join(tempRoot, entry.name);
      if (entry.isDirectory()) {
        const ownerPid = readOwnerPid(target);
        if (ownerPid !== null && ownerPid !== process.pid && isPidAlive(ownerPid)) continue;
        try {
          fs.rmSync(target, { recursive: true, force: true });
        } catch {}
        continue;
      }
      if (entry.name.endsWith(".json") || entry.name.endsWith(".cancel")) {
        try {
          fs.unlinkSync(target);
        } catch {}
      }
    }
  } catch {}
}
