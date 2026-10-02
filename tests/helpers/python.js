import { describe } from "vitest";
import { spawnSync } from "child_process";

export const PY = "python";

export const hasPython = (() => {
  try {
    return spawnSync(PY, ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
})();

export const describeIfPython = hasPython ? describe : describe.skip;

export const PY_CODE_PREFIX = "import sys; sys.path.insert(0, 'python'); ";
export const PY_CODE_PREFIX_UTF8 =
  "import sys; sys.stdout.reconfigure(encoding='utf-8'); sys.path.insert(0, 'python'); ";
