import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: `beru-processor.spec`'s `hiddenimports` only listed two modules.
 * PyInstaller's static analysis detects the rest today, but a future refactor
 * to dynamic imports would silently break the bundled binary. Listing all
 * local imports explicitly is a safety net.
 */

const specPath = path.join(process.cwd(), "python", "beru-processor.spec");
const processorPath = path.join(process.cwd(), "python", "processor.py");
const pythonDir = path.join(process.cwd(), "python");

function extractHiddenImports(specSrc) {
  const m = specSrc.match(/hiddenimports\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error("hiddenimports array not found in spec");
  const body = m[1];
  const re = /"([a-zA-Z_][a-zA-Z0-9_]*)"/g;
  const out = [];
  let mm;
  while ((mm = re.exec(body)) !== null) out.push(mm[1]);
  return out;
}

function extractLocalImports(pySrc) {
  const imports = new Set();
  const fromRe = /^\s*from\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+import\b/gm;
  let m;
  while ((m = fromRe.exec(pySrc)) !== null) imports.add(m[1]);
  const impRe = /^\s*import\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm;
  while ((m = impRe.exec(pySrc)) !== null) imports.add(m[1]);
  return [...imports].filter((mod) => fs.existsSync(path.join(pythonDir, `${mod}.py`)));
}

describe("beru-processor.spec hiddenimports covers processor.py local imports", () => {
  const specSrc = fs.readFileSync(specPath, "utf-8");
  const pySrc = fs.readFileSync(processorPath, "utf-8");

  const hidden = extractHiddenImports(specSrc);
  const localImports = extractLocalImports(pySrc);

  it("hiddenimports is non-empty and includes the historically-listed modules", () => {
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden).toContain("encode_profiles");
    expect(hidden).toContain("batch_errors");
  });

  it("every local import in processor.py is in hiddenimports", () => {
    const missing = localImports.filter((mod) => !hidden.includes(mod));
    if (missing.length > 0) {
      throw new Error(
        `processor.py imports ${missing.join(", ")} but beru-processor.spec hiddenimports is missing: ` +
          missing.join(", "),
      );
    }
  });
});
