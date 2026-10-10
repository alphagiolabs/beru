import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { shouldRestartElectronForPythonChange } from "../scripts/dev-python-watch.mjs";
import { extractLocalImports } from "./helpers/python-imports.js";

const pythonDir = path.join(process.cwd(), "python");
const processorPath = path.join(pythonDir, "processor.py");

describe("shouldRestartElectronForPythonChange", () => {
  it("covers every local import used by processor.py", () => {
    const localImports = extractLocalImports(fs.readFileSync(processorPath, "utf-8"));
    const missing = localImports.filter(
      (mod) => !shouldRestartElectronForPythonChange(`${mod}.py`),
    );
    expect(missing, `dev-python-watch allowlist missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("ignores test_*.py files", () => {
    expect(shouldRestartElectronForPythonChange("test_processor_context.py")).toBe(false);
    expect(shouldRestartElectronForPythonChange("test_delogo.py")).toBe(false);
  });

  it("ignores scratch/build scripts and non-py names", () => {
    expect(shouldRestartElectronForPythonChange("scratch.py")).toBe(false);
    expect(shouldRestartElectronForPythonChange("__pycache__")).toBe(false);
    expect(shouldRestartElectronForPythonChange(null)).toBe(false);
    expect(shouldRestartElectronForPythonChange("")).toBe(false);
  });

  it("uses the basename when Windows reports a relative path", () => {
    expect(shouldRestartElectronForPythonChange("subdir\\processor.py")).toBe(true);
    expect(shouldRestartElectronForPythonChange("subdir/test_delogo.py")).toBe(false);
  });
});
