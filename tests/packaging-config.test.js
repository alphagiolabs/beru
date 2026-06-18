import { describe, expect, it } from "vitest";
import fs from "fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));

describe("installer packaging config", () => {
  it("keeps static ffmpeg packages out of runtime dependencies", () => {
    expect(pkg.dependencies).not.toHaveProperty("ffmpeg-static");
    expect(pkg.dependencies).not.toHaveProperty("ffprobe-static");

    expect(pkg.devDependencies).toHaveProperty("ffmpeg-static");
    expect(pkg.devDependencies).toHaveProperty("ffprobe-static");
  });

  it("packages only the runtime python resources, not build artifacts", () => {
    expect(pkg.build.files).not.toContain("python/**/*");

    expect(pkg.build.files).toEqual(
      expect.arrayContaining(["!python/build/**", "!python/dist/**", "!python/__pycache__/**"]),
    );

    const pythonResource = pkg.build.extraResources.find(
      (entry) => entry && entry.from === "python" && entry.to === "python",
    );

    expect(pythonResource).toMatchObject({
      filter: expect.arrayContaining([
        "processor.py",
        "batch_errors.py",
        "encode_profiles.py",
        "!build/**",
        "!dist/**",
        "!__pycache__/**",
        "!test_*.py",
      ]),
    });
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
