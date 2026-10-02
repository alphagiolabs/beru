import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));

describe("installer packaging config", () => {
  it("keeps electron-builder dependency handling enabled after the processor build", async () => {
    const hook = { exports: {} };
    const require = createRequire(import.meta.url);
    vm.runInNewContext(fs.readFileSync(pkg.build.beforeBuild, "utf8"), {
      module: hook,
      __dirname: path.resolve("scripts"),
      process: { execPath: process.execPath },
      require: (name) =>
        name === "node:child_process" ? { spawnSync: () => ({ status: 0 }) } : require(name),
    });
    await expect(hook.exports()).resolves.toBe(true);
  });
  it("limits package installation and CI to Windows", () => {
    expect(pkg.os).toEqual(["win32"]);
    const workflow = fs.readFileSync(".github/workflows/ci-release.yml", "utf8");
    const runners = [...workflow.matchAll(/runs-on:\s*(\S+)/g)].map((match) => match[1]);
    expect(runners).toEqual(["windows-latest", "windows-latest"]);
  });
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
    const pythonResource = pkg.build.extraResources.find(
      (entry) => entry && entry.from === "python",
    );
    expect(pythonResource).toBeUndefined();

    expect(pkg.build.extraResources).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: "bin", to: "bin" })]),
    );

    expect(pkg.build.beforeBuild).toBe("scripts/build-processor.hook.cjs");
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

  it("includes the xlsx parser modules in the packaged app", () => {
    expect(pkg.dependencies).toHaveProperty("xlsx");

    expect(pkg.build.files).toEqual(
      expect.arrayContaining([
        "node_modules/xlsx/**/*",
        "node_modules/adler-32/**/*",
        "node_modules/cfb/**/*",
        "node_modules/crc-32/**/*",
        "node_modules/codepage/**/*",
        "node_modules/ssf/**/*",
        "node_modules/frac/**/*",
        "node_modules/wmf/**/*",
        "node_modules/word/**/*",
      ]),
    );
  });
});
