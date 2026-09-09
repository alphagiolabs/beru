import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const scriptPath = path.join(process.cwd(), "scripts", "dev.mjs");
const src = fs.readFileSync(scriptPath, "utf-8");

describe("scripts/dev.mjs: Electron restart cleans up the previous exit listener", () => {
  it("calls removeListener('exit', ...) before killTree on restart", () => {
    const restartBlockMatch = src.match(/restartTimer = setTimeout\(\(\) => \{([\s\S]*?)\}, 500\)/);
    expect(restartBlockMatch, "restart timer block must exist").not.toBeNull();
    const restartBlock = restartBlockMatch[1];

    expect(restartBlock).toMatch(/removeListener\s*\(\s*["']exit["']/);
    const removeIdx = restartBlock.search(/removeListener\s*\(\s*["']exit["']/);
    const killIdx = restartBlock.search(/killTree\s*\(/);
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(killIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeLessThan(killIdx);
  });

  it("does not register the exit handler with a bare arrow that cannot be removed", () => {
    const restartBlockMatch = src.match(/restartTimer = setTimeout\(\(\) => \{([\s\S]*?)\}, 500\)/);
    const restartBlock = restartBlockMatch ? restartBlockMatch[1] : "";
    expect(restartBlock).not.toMatch(/electron\.on\(\s*["']exit["']\s*,\s*\(/);
  });
});
