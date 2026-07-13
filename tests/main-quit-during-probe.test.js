import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: quit during the ffprobe probe phase used to skip cancel because
 * before-quit/will-quit only gated on getPythonProcess(). With no child yet,
 * the app exited while the runId stayed live — probe completion could then
 * spawn an orphaned beru-processor.exe.
 */

const mainSrc = fs.readFileSync(path.join(process.cwd(), "main", "main.js"), "utf-8");
const processSrc = fs.readFileSync(
  path.join(process.cwd(), "main", "handlers", "process.js"),
  "utf-8",
);
const sharedSrc = fs.readFileSync(path.join(process.cwd(), "main", "shared-state.js"), "utf-8");

describe("quit during probe phase", () => {
  it("gates quit on hasActiveProcessing, not only getPythonProcess", () => {
    expect(mainSrc).toMatch(/hasActiveProcessing\(\)/);
    expect(mainSrc).toMatch(/setAppIsQuitting\(true\)/);
    expect(mainSrc).toMatch(/cancelActiveProcessing\(\)/);
    // Must not early-return solely on missing python child before cancel.
    expect(mainSrc).not.toMatch(/if \(!getPythonProcess\(\)\) return;/);
  });

  it("exports appIsQuitting helpers from shared-state", () => {
    expect(sharedSrc).toMatch(/export const getAppIsQuitting/);
    expect(sharedSrc).toMatch(/export const setAppIsQuitting/);
    expect(sharedSrc).toMatch(/export const hasActiveProcessing/);
  });

  it("bails spawn when getAppIsQuitting after probe", () => {
    const probeIdx = processSrc.indexOf("enrichJobVideoInfo");
    const spawnIdx = processSrc.indexOf("spawn(spawnSpec.command");
    expect(probeIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(probeIdx);
    const between = processSrc.slice(probeIdx, spawnIdx);
    expect(between).toMatch(/getAppIsQuitting\(\)/);
    expect(between).toMatch(/cancelled\s*:\s*true/);
  });

  it("clears owned processing run on every getAppIsQuitting early bail before spawn", () => {
    // Anchor after the concurrency probe call site, not the enrichJobVideoInfo
    // function definition higher in the file.
    const probeCallIdx = processSrc.indexOf("runWithConcurrency(");
    const spawnIdx = processSrc.indexOf("spawn(spawnSpec.command");
    expect(probeCallIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(probeCallIdx);
    const between = processSrc.slice(probeCallIdx, spawnIdx);

    // Post-probe early returns that check quitting must release an owned run
    // so a quit/probe race cannot leave the lock stuck.
    const bailRe =
      /if\s*\(\s*!isCurrentRun\(\)\s*\|\|\s*getAppIsQuitting\(\)\s*\)\s*\{[\s\S]*?return\s*\{\s*success:\s*false,\s*error:\s*"Procesamiento cancelado"/g;
    const bailBlocks = between.match(bailRe) || [];
    expect(bailBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of bailBlocks) {
      expect(block).toMatch(/clearProcessingRun\(runId\)/);
      expect(block).toMatch(/setProbePhaseActive\(false\)/);
    }
  });

  it("refuses to begin a processing run while app is quitting", () => {
    const beginIdx = processSrc.indexOf("beginProcessingRun(runId)");
    expect(beginIdx).toBeGreaterThan(-1);
    const beforeBegin = processSrc.slice(0, beginIdx);
    // Last getAppIsQuitting guard before beginProcessingRun must short-circuit.
    const guardIdx = beforeBegin.lastIndexOf("getAppIsQuitting()");
    expect(guardIdx).toBeGreaterThan(-1);
    const guardSlice = beforeBegin.slice(guardIdx, beginIdx);
    expect(guardSlice).toMatch(/cancelled\s*:\s*true/);
  });

  it("disposes temp files after cancel, not before", () => {
    // cancelActiveProcessing().finally(() => { disposeOnQuit(); app.quit(); })
    expect(mainSrc).toMatch(
      /cancelActiveProcessing\(\)\.finally\(\(\)\s*=>\s*\{[\s\S]*disposeOnQuit\(\)/,
    );
  });
});
