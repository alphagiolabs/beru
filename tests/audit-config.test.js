import { describe, it, expect } from "vitest";
import fs from "fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf-8"));
const changelog = fs.readFileSync("CHANGELOG.md", "utf-8");

const viteConfig = fs.readFileSync("vite.config.js", "utf-8");
const eslintConfig = fs.readFileSync("eslint.config.js", "utf-8");
const regressionGuard = fs.readFileSync("scripts/regression-guard.sh", "utf-8");
const releaseLoop = fs.readFileSync("scripts/release-loop.mjs", "utf-8");

describe("audit: project configuration", () => {
  it("package.json and package-lock.json versions match", () => {
    expect(lock.version).toBe(pkg.version);
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(3);
  });

  it("CHANGELOG has an entry for the current package version", () => {
    const header = `## [${pkg.version}]`;
    expect(changelog.includes(header)).toBe(true);
  });

  it.skip("Vite config should enable source maps for production", () => {
    // TODO: enable sourcemap once audit fixes are applied
    expect(viteConfig).toMatch(/sourcemap\s*:\s*(true|"hidden")/);
  });

  it("Vite config splits React and vendor chunks", () => {
    expect(viteConfig).toMatch(/manualChunks\s*:/);
    const chunkNames = viteConfig.match(/manualChunks\s*:\s*\{([^}]*)\}/s)?.[1] || "";
    expect(chunkNames).toMatch(/react|vendor|xlsx/);
  });

  it("ESLint config includes node globals for scripts and main", () => {
    expect(eslintConfig).toMatch(/globals\.node/);
  });

  it("electron-builder output directory is consistent", () => {
    expect(pkg.build.directories.output).toBe("dist-installer");
  });

  it("regression guard reduces Vitest summaries to one numeric total", () => {
    const totalLines = regressionGuard
      .split(/\r?\n/)
      .filter((line) => /(?:BASELINE|CURRENT)_TOTAL=/.test(line));

    expect(totalLines).toHaveLength(2);
    for (const line of totalLines) expect(line).toContain("| tail -1");
  });

  it("release loop checks git ancestry without Unix-only shell redirection", () => {
    expect(releaseLoop).not.toContain("2>/dev/null");
    expect(releaseLoop).toMatch(/execFileSync\(\s*["']git["']/);
  });
});
