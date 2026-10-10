import { describe } from "vitest";
import { spawnSync } from "child_process";

const PY = "python";

const hasPython = (() => {
  try {
    return spawnSync(PY, ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
})();

export const describeIfPython = hasPython ? describe : describe.skip;
