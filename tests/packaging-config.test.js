import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const pythonDir = path.join(process.cwd(), "python");
const processorPath = path.join(pythonDir, "processor.py");
const specPath = path.join(pythonDir, "beru-processor.spec");

function extractLocalImports(pySrc) {
  const imports = new Set();
  const fromRe = /^\s*from\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+import\b/gm;
  let m;
  while ((m = fromRe.exec(pySrc)) !== null) imports.add(m[1]);
  const impRe = /^\s*import\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm;
  while ((m = impRe.exec(pySrc)) !== null) imports.add(m[1]);
  return [...imports].filter((mod) => fs.existsSync(path.join(pythonDir, `${mod}.py`)));
}

function extractHiddenImports(specSrc) {
  const m = specSrc.match(/hiddenimports\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error("hiddenimports array not found in beru-processor.spec");
  const out = [];
  const re = /"([a-zA-Z_][a-zA-Z0-9_]*)"/g;
  let mm;
  while ((mm = re.exec(m[1])) !== null) out.push(mm[1]);
  return out;
}

describe("installer packaging config", () => {
  it("keeps static ffmpeg packages out of runtime dependencies", () => {
    expect(pkg.dependencies).not.toHaveProperty("ffmpeg-static");
    expect(pkg.dependencies).not.toHaveProperty("ffprobe-static");

    expect(pkg.devDependencies).toHaveProperty("ffmpeg-static");
    expect(pkg.devDependencies).toHaveProperty("ffprobe-static");
  });

  it("excludes python sources and build artifacts from the asar files list", () => {
    expect(pkg.build.files).not.toContain("python/**/*");

    expect(pkg.build.files).toEqual(
      expect.arrayContaining(["!python/build/**", "!python/dist/**", "!python/__pycache__/**"]),
    );
  });

  it("ships the processor as beru-processor via bin/, not loose incomplete .py scripts", () => {
    // Production always prefers/requires the PyInstaller binary under resources/bin.
    // Shipping a partial python/ script set (missing op_shared, delogo_chains, …)
    // confuses the mental model and would break if script mode were ever used.
    const pythonResource = pkg.build.extraResources.find(
      (entry) => entry && entry.from === "python",
    );
    expect(pythonResource).toBeUndefined();

    expect(pkg.build.extraResources).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: "bin", to: "bin" })]),
    );

    // beforeBuild must still build the exe into bin/ before packaging.
    expect(pkg.build.beforeBuild).toBe("scripts/build-processor.hook.cjs");
  });

  it("covers every processor.py local import via beru-processor.spec hiddenimports (bundled path)", () => {
    const pySrc = fs.readFileSync(processorPath, "utf-8");
    const specSrc = fs.readFileSync(specPath, "utf-8");
    const localImports = extractLocalImports(pySrc);
    const hidden = extractHiddenImports(specSrc);

    expect(localImports.length).toBeGreaterThan(0);
    const missing = localImports.filter((mod) => !hidden.includes(mod));
    if (missing.length > 0) {
      throw new Error(
        `processor.py imports ${missing.join(", ")} but beru-processor.spec hiddenimports is missing: ` +
          missing.join(", ") +
          " (installer ships the PyInstaller binary from bin/, not loose scripts)",
      );
    }
  });

  it("includes the updater runtime modules in the packaged app", () => {
    expect(pkg.dependencies).toHaveProperty("electron-updater");

    expect(pkg.build.files).toEqual(
      expect.arrayContaining([
        "node_modules/electron-updater/**/*",
        "node_modules/js-yaml/**/*",
        "node_modules/lazy-val/**/*",
        "node_modules/lodash.escaperegexp/**/*",
        "node_modules/lodash.isequal/**/*",
        "node_modules/tiny-typed-emitter/**/*",
        "node_modules/debug/**/*",
        "node_modules/ms/**/*",
        "node_modules/sax/**/*",
        "node_modules/argparse/**/*",
        "node_modules/graceful-fs/**/*",
      ]),
    );
  });
});
