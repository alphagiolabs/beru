import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";

const PY = process.platform === "win32" ? "python" : "python3";
const hasPython = (() => {
  try {
    const r = spawnSync(PY, ["--version"], { encoding: "utf8" });
    return r.status === 0;
  } catch {
    return false;
  }
})();
const describeIfPython = hasPython ? describe : describe.skip;

describeIfPython("python op_shared enable clauses", () => {
  const PY_CODE_PREFIX = "import sys; sys.path.insert(0, 'python'); ";

  it("uses gte when only start_time is set", () => {
    const code = `
from op_shared import _build_enable_clause
print(_build_enable_clause({"start_time": 10}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("enable=gte(t\\,10.000000)");
  });

  it("uses lte when only end_time is set", () => {
    const code = `
from op_shared import _build_enable_clause
print(_build_enable_clause({"end_time": 20}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("enable=lte(t\\,20.000000)");
  });
});
