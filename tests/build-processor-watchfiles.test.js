import { describe, it } from "vitest";
import fs from "fs";
import path from "path";
import { extractLocalImports } from "./helpers/python-imports.js";

const root = process.cwd();
const scriptPath = path.join(root, "scripts", "build-processor.mjs");
const processorPath = path.join(root, "python", "processor.py");

function extractWatchFiles(scriptSrc) {
  const m = scriptSrc.match(/const watchFiles = \[([\s\S]*?)\];/);
  if (!m) throw new Error("watchFiles array not found in build-processor.mjs");
  const body = m[1];
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

describe("build-processor watchFiles covers processor.py local imports", () => {
  const scriptSrc = fs.readFileSync(scriptPath, "utf-8");
  const pySrc = fs.readFileSync(processorPath, "utf-8");

  const watchFiles = extractWatchFiles(scriptSrc);
  const localImports = extractLocalImports(pySrc);

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
