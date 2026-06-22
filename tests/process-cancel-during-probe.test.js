import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: `main/handlers/process.js` spawned the Python processor AFTER
 * a slow `enrichJobVideoInfo` probe, but did not check whether the run was
 * still active before spawning. If the user cancelled during the probe,
 * `cancelActiveProcessing()` cleared the runId and tmpFile, but the code
 * continued to spawn — leaving an orphaned Python process that nobody owned
 * and that the renderer could no longer cancel.
 *
 * This test asserts the handler bails between probe and spawn when the run
 * was cancelled mid-probe.
 */

const filePath = path.join(process.cwd(), "main", "handlers", "process.js");
const src = fs.readFileSync(filePath, "utf-8");

describe("main/handlers/process.js: cancel-during-probe race", () => {
  it("checks isCurrentRun() after enrichJobVideoInfo and before spawn", () => {
    // Locate the probe call and the spawn call in order.
    const probeIdx = src.indexOf("enrichJobVideoInfo");
    expect(probeIdx).toBeGreaterThan(-1);
    const spawnIdx = src.indexOf("spawn(spawnSpec.command");
    expect(spawnIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(probeIdx);

    // Between the two, there must be an isCurrentRun() guard that bails.
    const between = src.slice(probeIdx, spawnIdx);
    expect(between).toMatch(/isCurrentRun\(\)/);
    expect(between).toMatch(/cancelled\s*:\s*true/);
    // And the bail must happen BEFORE writeFile (so we don't write a manifest
    // for a cancelled run).
    const writeFileIdx = between.indexOf("fs.promises.writeFile");
    if (writeFileIdx >= 0) {
      const guardIdx = between.indexOf("isCurrentRun()");
      expect(guardIdx).toBeGreaterThanOrEqual(0);
      expect(guardIdx).toBeLessThan(writeFileIdx);
    }
  });
});
