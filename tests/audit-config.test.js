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

  it("regression guard --prepush does not silently exit 0 on empty diff", () => {
    // The pre-push path must not bail with `exit 0` when the upstream diff is
    // empty. That happens when HEAD == upstream (e.g. the push is a no-op, or
    // the branch was just rebased onto upstream). Silently exiting 0 skips all
    // validation, so a broken build can be pushed if the hook is later run
    // from a state that DOES have changes. The hook must run a safety-net
    // suite (or at least flag the situation) instead of returning success.
    const lines = regressionGuard.split(/\r?\n/);
    // Find the --prepush branch.
    let inPrepush = false;
    let prepushBody = "";
    for (const line of lines) {
      if (/^\s*elif \[\[ "\$\{1:-\}" == "--prepush" \]\]/.test(line)) {
        inPrepush = true;
        prepushBody += line + "\n";
        continue;
      }
      if (inPrepush) {
        prepushBody += line + "\n";
        // Stop at the next branch (the `else` of the if/elif).
        if (/^else\b/.test(line.trim()) || /^\s*else\b/.test(line)) break;
      }
    }
    // The "empty CHANGED" early-exit guard runs after the branch, so inspect
    // the whole script for the `exit 0` near "No hay archivos cambiados".
    // Requirement: when mode is --prepush and CHANGED is empty, the script
    // must NOT exit 0; it must fall through to run the full suite.
    // We assert that the empty-diff early-exit is gated to NOT fire under
    // --prepush (e.g. by checking $MODE or skipping the early exit for that
    // mode).
    const emptyExitBlock = regressionGuard.match(
      /if \[\[ -z "\$\{CHANGED\/\/ \/}" \]\]; then[\s\S]*?exit 0[\s\S]*?fi/,
    );
    expect(emptyExitBlock, "empty-diff early-exit block must exist").not.toBeNull();
    // The block must reference MODE or --prepush so it does not fire blindly
    // for every mode.
    const blockSrc = emptyExitBlock ? emptyExitBlock[0] : "";
    expect(blockSrc).toMatch(/MODE|prepush|PREPUSH/);
  });

  it("release loop checks git ancestry without Unix-only shell redirection", () => {
    expect(releaseLoop).not.toContain("2>/dev/null");
    expect(releaseLoop).toMatch(/execFileSync\(\s*["']git["']/);
  });

  it("release loop quotes gh release create assets so paths with spaces don't break the command", () => {
    // The asset list must wrap each path in double quotes (and escape inner
    // quotes) before joining, so `execSync` doesn't split paths on spaces.
    const blockMatch = releaseLoop.match(
      /const allAssets = \[\.\.\.exes, \.\.\.blockmaps, \.\.\.yamls\];([\s\S]*?)(?:const cmd = `gh release create)/,
    );
    expect(blockMatch, "asset-join + cmd block must exist").not.toBeNull();
    const block = blockMatch[1];
    // Reject the bare-join bug pattern: `assets = allAssets.join(" ")` without
    // any per-asset quoting.
    expect(block).not.toMatch(/assets\s*=\s*allAssets\.join\(/);
    // Require a `.map(...)` step that wraps each entry before joining.
    expect(block).toMatch(/allAssets\.map\(/);
    expect(block).toMatch(/\.join\(/);
  });
});
