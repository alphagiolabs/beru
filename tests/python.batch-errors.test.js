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

describeIfPython("python batch_errors module", () => {
  const PY_CODE_PREFIX = "import sys; sys.path.insert(0, 'python'); ";

  it("classifies memory pressure and formats user-facing errors", () => {
    const code = `
import json
from batch_errors import is_resource_pressure_error, format_processing_error

raw = "x264 [error]: malloc of size 11619264 failed"
print(json.dumps({
    "memory": is_resource_pressure_error(raw),
    "message": format_processing_error(raw, max_workers=4),
}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }

    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.memory).toBe(true);
    expect(parsed.message).toContain("Memoria insuficiente");
    expect(parsed.message).toContain("4 videos en paralelo");
  });
});
