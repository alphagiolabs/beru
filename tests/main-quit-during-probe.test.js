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

  it("disposes temp files after cancel, not before", () => {
    // cancelActiveProcessing().finally(() => { disposeOnQuit(); app.quit(); })
    expect(mainSrc).toMatch(
      /cancelActiveProcessing\(\)\.finally\(\(\)\s*=>\s*\{[\s\S]*disposeOnQuit\(\)/,
    );
  });
});
