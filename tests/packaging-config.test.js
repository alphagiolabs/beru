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
    const scripts = [];
    vm.runInNewContext(fs.readFileSync(pkg.build.beforeBuild, "utf8"), {
      module: hook,
      __dirname: path.resolve("scripts"),
      process: { execPath: process.execPath },
      require: (name) =>
        name === "node:child_process"
          ? {
              spawnSync: (_command, args) => {
                scripts.push(path.basename(args[0]));
                return { status: 0 };
              },
            }
          : require(name),
    });
    await expect(hook.exports()).resolves.toBe(true);
    expect(scripts).toEqual(["fetch-ffmpeg.mjs", "build-processor.mjs"]);
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

  it("keeps only main-process modules as runtime dependencies", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["electron-updater", "xlsx"]);
  });

  it("bundles renderer dependencies through Vite instead of manual node_modules globs", () => {
    for (const dependency of [
      "@supabase/supabase-js",
      "@tanstack/react-virtual",
      "clsx",
      "lucide-react",
      "radix-ui",
      "react",
      "react-dom",
      "tailwind-merge",
      "zustand",
    ]) {
      expect(pkg.devDependencies).toHaveProperty(dependency);
    }
    expect(pkg.build.files.some((pattern) => pattern.includes("node_modules/"))).toBe(false);
  });
});
