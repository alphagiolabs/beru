import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ROOT = path.join(ROOT, ".tmp");

export function createTestEnvironment() {
  mkdirSync(TEST_ROOT, { recursive: true });
  const directory = mkdtempSync(path.join(TEST_ROOT, "beru-test-"));

  return {
    directory,
    env: {
      TEMP: directory,
      TMP: directory,
      TMPDIR: directory,
      BERU_LOG_DIR: path.join(directory, "logs"),
      PYTHONDONTWRITEBYTECODE: "1",
    },
    cleanup() {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
