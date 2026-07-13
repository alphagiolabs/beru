import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { shouldRestartElectronForPythonChange } from "../scripts/dev-python-watch.mjs";

/**
 * Regression: `scripts/dev.mjs` restarted Electron on ANY `.py` change under
 * `python/`, including test files and scratch scripts. Editing tests while
 * `npm run dev` was running closed and reopened the app repeatedly.
 *
 * Only runtime processor modules should trigger an Electron restart.
 */

const pythonDir = path.join(process.cwd(), "python");
const processorPath = path.join(pythonDir, "processor.py");

function extractLocalImports(pySrc) {
  const imports = new Set();
  const fromRe = /^\s*from\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+import\b/gm;
  let m;
  while ((m = fromRe.exec(pySrc)) !== null) imports.add(m[1]);
  const impRe = /^\s*import\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm;
  while ((m = impRe.exec(pySrc)) !== null) imports.add(m[1]);
  return [...imports].filter((mod) => fs.existsSync(path.join(pythonDir, `${mod}.py`)));
}

describe("shouldRestartElectronForPythonChange", () => {
  it("restarts for processor.py and its local modules", () => {
    expect(shouldRestartElectronForPythonChange("processor.py")).toBe(true);
    expect(shouldRestartElectronForPythonChange("batch_errors.py")).toBe(true);
    expect(shouldRestartElectronForPythonChange("op_shared.py")).toBe(true);
    expect(shouldRestartElectronForPythonChange("delogo_chains.py")).toBe(true);
    expect(shouldRestartElectronForPythonChange("encode_profiles.py")).toBe(true);
    expect(shouldRestartElectronForPythonChange("color_validation.py")).toBe(true);
    expect(shouldRestartElectronForPythonChange("text_layout_helpers.py")).toBe(true);
  });

  it("covers every local import used by processor.py", () => {
    const localImports = extractLocalImports(fs.readFileSync(processorPath, "utf-8"));
    const missing = localImports.filter(
      (mod) => !shouldRestartElectronForPythonChange(`${mod}.py`),
    );
    expect(missing, `dev-python-watch allowlist missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("ignores test_*.py files", () => {
    expect(shouldRestartElectronForPythonChange("test_batch_summary_cancelled.py")).toBe(false);
    expect(shouldRestartElectronForPythonChange("test_delogo.py")).toBe(false);
  });

  it("ignores scratch/build scripts and non-py names", () => {
    expect(shouldRestartElectronForPythonChange("build_excel_template.py")).toBe(false);
    expect(shouldRestartElectronForPythonChange("__pycache__")).toBe(false);
    expect(shouldRestartElectronForPythonChange(null)).toBe(false);
    expect(shouldRestartElectronForPythonChange("")).toBe(false);
  });

  it("uses the basename when Windows reports a relative path", () => {
    expect(shouldRestartElectronForPythonChange("subdir\\processor.py")).toBe(true);
    expect(shouldRestartElectronForPythonChange("subdir/test_delogo.py")).toBe(false);
  });
});
