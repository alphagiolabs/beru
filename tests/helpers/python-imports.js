import fs from "fs";
import path from "path";

const pythonDir = path.join(process.cwd(), "python");

export function extractLocalImports(pySrc, dir = pythonDir) {
  const imports = new Set();
  const fromRe = /^\s*from\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+import\b/gm;
  let m;
  while ((m = fromRe.exec(pySrc)) !== null) imports.add(m[1]);
  const impRe = /^\s*import\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm;
  while ((m = impRe.exec(pySrc)) !== null) imports.add(m[1]);
  return [...imports].filter((mod) => fs.existsSync(path.join(dir, `${mod}.py`)));
}

export function extractHiddenImports(specSrc) {
  const m = specSrc.match(/hiddenimports\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error("hiddenimports array not found");
  const out = [];
  const re = /"([a-zA-Z_][a-zA-Z0-9_]*)"/g;
  let mm;
  while ((mm = re.exec(m[1])) !== null) out.push(mm[1]);
  return out;
}
