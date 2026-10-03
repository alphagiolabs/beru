import { it, expect } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

it("accepts an unsigned executable only for unsigned distribution", () => {
  const directory = mkdtempSync(join(tmpdir(), "beru-signature-"));
  try {
    copyFileSync(
      require.resolve("@esbuild/win32-x64/esbuild.exe"),
      join(directory, "Beru-Setup-test.exe"),
    );
    const run = (mode) =>
      spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve("scripts/verify-installer-signature.ps1"),
          "-Mode",
          mode,
          "-Directory",
          directory,
        ],
        { encoding: "utf8", timeout: 15000, windowsHide: true },
      );
    const unsigned = run("unsigned");
    expect(unsigned.error).toBeUndefined();
    expect(unsigned.status, unsigned.stderr).toBe(0);
    const signed = run("signed");
    expect(signed.error).toBeUndefined();
    expect(signed.status).toBe(1);
    expect(signed.stderr).toContain("requires a Valid Authenticode signature");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
