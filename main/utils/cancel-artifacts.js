import fs from "fs";
import path from "path";

const TEMP_DIR_PREFIX = "beru-jobs-";
const ORPHAN_PREFIXES = [TEMP_DIR_PREFIX, "beru-temporal-", "beru-preview-"];
const MANIFEST_NAME = "manifest.json";

const sentinelPathFor = (manifestPath) => {
  const { dir, name } = path.parse(manifestPath);
  return path.join(dir, `${name}.cancel`);
};

export async function createCancelArtifacts(tempRoot) {
  const dir = await fs.promises.mkdtemp(path.join(tempRoot, TEMP_DIR_PREFIX));
  const manifestPath = path.join(dir, MANIFEST_NAME);
  const cancelPath = sentinelPathFor(manifestPath);
  return {
    manifestPath,
    markCancelled() {
      try {
        fs.writeFileSync(cancelPath, "1");
      } catch {}
    },
    isCancelled() {
      return fs.existsSync(cancelPath);
    },
    dispose() {
      for (const file of [manifestPath, cancelPath]) {
        try {
          fs.unlinkSync(file);
        } catch {}
      }
      try {
        fs.rmdirSync(dir);
      } catch {}
    },
  };
}

export function sweepOrphanedArtifacts(tempRoot) {
  try {
    for (const entry of fs.readdirSync(tempRoot, { withFileTypes: true })) {
      if (!ORPHAN_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
      const target = path.join(tempRoot, entry.name);
      if (entry.isDirectory()) {
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
