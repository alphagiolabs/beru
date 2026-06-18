import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

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

describeIfPython("python processor logging", () => {
  it("imports with stderr-only logging when the log path is unusable", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beru-log-test-"));
    const blockedLogDir = path.join(tmp, "logs");
    fs.writeFileSync(blockedLogDir, "not a directory");

    const code = "import sys; sys.path.insert(0, 'python'); import processor; print('ok')";
    const r = spawnSync(PY, ["-c", code], {
      cwd: process.cwd(),
      env: { ...process.env, BERU_LOG_DIR: blockedLogDir },
      encoding: "utf8",
    });

    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("ok");
  });
});
