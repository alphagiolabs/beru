import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const pyDir = join(process.cwd(), "python");
const runnerPath = join(process.cwd(), "scripts", "test-python.mjs");

describe("python test wiring", () => {
  const files = readdirSync(pyDir).filter((f) => f.startsWith("test_") && f.endsWith(".py"));

  it("npm run test:python delegates to the test-python.mjs runner", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts["test:python"]).toBe("node scripts/test-python.mjs");
    expect(existsSync(runnerPath), "scripts/test-python.mjs must exist").toBe(true);
  });

  it("the runner discovers every test_*.py file on disk", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { listPythonTests } from "./scripts/test-python.mjs"; console.log(JSON.stringify(listPythonTests()));',
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([...files].sort());
  });

  it.each(files)("%s invokes every top-level test_* function it defines", (file) => {
    const src = readFileSync(join(pyDir, file), "utf8");
    const defined = [...src.matchAll(/^def (test_\w+)\(/gm)].map((m) => m[1]);
    for (const name of defined) {
      const occurrences = src.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
      expect(occurrences, `${name} is defined but never invoked`).toBeGreaterThanOrEqual(2);
    }
  });
});
