import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "main", "handlers", "process.js");
const src = fs.readFileSync(filePath, "utf-8");

describe("main/handlers/process.js: cancel-during-probe race", () => {
  it("checks isCurrentRun() after enrichJobVideoInfo and before spawn", () => {
    const probeIdx = src.indexOf("enrichJobVideoInfo");
    expect(probeIdx).toBeGreaterThan(-1);
    const spawnIdx = src.indexOf("spawn(spawnSpec.command");
    expect(spawnIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(probeIdx);

    const between = src.slice(probeIdx, spawnIdx);
    expect(between).toMatch(/isCurrentRun\(\)/);
    expect(between).toMatch(/cancelled\s*:\s*true/);
    const writeFileIdx = between.indexOf("fs.promises.writeFile");
    if (writeFileIdx >= 0) {
      const guardIdx = between.indexOf("isCurrentRun()");
      expect(guardIdx).toBeGreaterThanOrEqual(0);
      expect(guardIdx).toBeLessThan(writeFileIdx);
    }
  });

  it("also guards isCurrentRun after writeFile before spawn", () => {
    const writeIdx = src.indexOf("fs.promises.writeFile");
    const spawnIdx = src.indexOf("spawn(spawnSpec.command");
    expect(writeIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(writeIdx);
    const between = src.slice(writeIdx, spawnIdx);
    expect(between).toMatch(/isCurrentRun\(\)/);
    expect(between).toMatch(/cancelled\s*:\s*true/);
  });
});
