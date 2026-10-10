import { expect, it } from "vitest";
import { spawnSync } from "child_process";
import { describeIfPython } from "./helpers/python.js";

const PY = "python";

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

  it("does not treat generic filter failures as hardware encode errors", () => {
    const code = `
import json
from batch_errors import is_hardware_encode_error

msg = "Error while filtering: Cannot allocate memory for filter graph"
print(json.dumps(is_hardware_encode_error(msg)))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toBe(false);
  });
});
