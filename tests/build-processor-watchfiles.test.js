import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: `scripts/build-processor.mjs`'s `isUpToDate()` hardcodes a
 * `watchFiles` list. If a Python module imported by `processor.py` is missing
 * from that list, editing it won't trigger a rebuild → stale binary.
 *
 * This test cross-checks the hardcoded list against the actual local imports
 * in `processor.py` so adding a new module (or forgetting one) fails CI.
 */

const root = process.cwd();
const scriptPath = path.join(root, "scripts", "build-processor.mjs");
const processorPath = path.join(root, "python", "processor.py");
const pythonDir = path.join(root, "python");

function extractWatchFiles(scriptSrc) {
  // Capture the `watchFiles = [ ... ]` array literal contents.
  const m = scriptSrc.match(/const watchFiles = \[([\s\S]*?)\];/);
  if (!m) throw new Error("watchFiles array not found in build-processor.mjs");
  const body = m[1];
  // Extract `join(pythonDir, "X.py")` and bare string entries.
  const files = [];
  const joinRe = /join\(\s*pythonDir,\s*"([^"]+)"\s*\)/g;
  let jm;
  while ((jm = joinRe.exec(body)) !== null) files.push(jm[1]);
  const strRe = /"([^"]+\.py)"/g;
  let sm;
  while ((sm = strRe.exec(body)) !== null) {
    if (!files.includes(sm[1])) files.push(sm[1]);
  }
  return files;
}

function extractLocalImports(pySrc) {
  // Match `from <module> import ...` and `import <module>` where <module> is a
  // bare name (no dot, no package) that resolves to a local .py file.
  const imports = new Set();
  const fromRe = /^\s*from\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+import\b/gm;
  let m;
  while ((m = fromRe.exec(pySrc)) !== null) imports.add(m[1]);
  const impRe = /^\s*import\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm;
  while ((m = impRe.exec(pySrc)) !== null) imports.add(m[1]);
  // Filter to files that actually exist in python/ (local modules only).
  return [...imports].filter((mod) => fs.existsSync(path.join(pythonDir, `${mod}.py`)));
}

describe("build-processor watchFiles covers processor.py local imports", () => {
  const scriptSrc = fs.readFileSync(scriptPath, "utf-8");
  const pySrc = fs.readFileSync(processorPath, "utf-8");

  const watchFiles = extractWatchFiles(scriptSrc);
  const localImports = extractLocalImports(pySrc);

  it("watchFiles is non-empty and includes processor.py", () => {
    expect(watchFiles.length).toBeGreaterThan(0);
    expect(watchFiles).toContain("processor.py");
  });

  it("every local import in processor.py is in watchFiles", () => {
    const missing = localImports.filter((mod) => !watchFiles.includes(`${mod}.py`));
    if (missing.length > 0) {
      throw new Error(
        `processor.py imports ${missing.join(", ")} but build-processor.mjs watchFiles is missing: ` +
          missing.map((m) => `${m}.py`).join(", "),
      );
    }
  });
});
