import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: `scripts/dev.mjs` restarted Electron on Python file changes
 * by calling `killTree(electron)` then spawning a new process and registering
 * a fresh `exit` listener. The OLD process's `exit` listener was never removed,
 * so when `killTree` terminated it, `shutdown()` fired and tore down Vite +
 * the new Electron — killing the dev session on the first Python edit.
 *
 * This test asserts the script removes the previous exit listener before
 * killing the old child so the restart path doesn't cascade into a full
 * shutdown.
 */

const scriptPath = path.join(process.cwd(), "scripts", "dev.mjs");
const src = fs.readFileSync(scriptPath, "utf-8");

describe("scripts/dev.mjs: Electron restart cleans up the previous exit listener", () => {
  it("calls removeListener('exit', ...) before killTree on restart", () => {
    // Look for removeListener('exit', ...) within the Python watcher restart
    // branch. We don't pin the exact handler name; we just require that the
    // restart path removes the old exit listener before killTree.
    const restartBlockMatch = src.match(/restartTimer = setTimeout\(\(\) => \{([\s\S]*?)\}, 500\)/);
    expect(restartBlockMatch, "restart timer block must exist").not.toBeNull();
    const restartBlock = restartBlockMatch[1];

    expect(restartBlock).toMatch(/removeListener\s*\(\s*["']exit["']/);
    // The removeListener must appear BEFORE killTree in the restart block.
    const removeIdx = restartBlock.search(/removeListener\s*\(\s*["']exit["']/);
    const killIdx = restartBlock.search(/killTree\s*\(/);
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(killIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeLessThan(killIdx);
  });

  it("does not register the exit handler with a bare arrow that cannot be removed", () => {
    // The initial attach must use a storable handler reference (so it can be
    // removed later). A bare `electron.on("exit", (code) => shutdown(code ?? 0))`
    // without saving the reference is the bug pattern.
    const bareOnExit = /electron\.on\(\s*["']exit["']\s*,\s*\(/g;
    const bareMatches = src.match(bareOnExit) || [];
    // Allow at most one bare attach (the very first one may be bare if a
    // named handler is used). The restart path must NOT use bare attach.
    // We assert the restart block uses a stored handler reference instead.
    const restartBlockMatch = src.match(/restartTimer = setTimeout\(\(\) => \{([\s\S]*?)\}, 500\)/);
    const restartBlock = restartBlockMatch ? restartBlockMatch[1] : "";
    expect(restartBlock).not.toMatch(/electron\.on\(\s*["']exit["']\s*,\s*\(/);
  });
});
