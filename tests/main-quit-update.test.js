import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__dirname, "..", "main", "main.js"), "utf-8");
const updaterSrc = readFileSync(path.join(__dirname, "..", "main", "updater.js"), "utf-8");

describe("main/main.js quit handlers during update install", () => {
  it("does not intercept before-quit when quitting for an update", () => {
    expect(mainSrc).toMatch(/isQuittingForUpdate\(\)\) return/);
    expect(mainSrc).toMatch(/interceptQuitIfProcessing/);
  });

  it("does not intercept will-quit when quitting for an update", () => {
    // Both quit events share interceptQuitIfProcessing which early-returns
    // when isQuittingForUpdate() is true (cancel happens in scheduleInstall).
    expect(mainSrc).toMatch(/app\.on\("will-quit"/);
    expect(mainSrc).toMatch(/app\.on\("before-quit"/);
    expect(mainSrc).toMatch(/if \(isQuittingForUpdate\(\)\) return/);
  });
});

describe("main/updater.js cancels processing before quitAndInstall", () => {
  it("calls cancelActiveProcessing before quitAndInstall", () => {
    const cancelIdx = updaterSrc.indexOf("cancelActiveProcessing");
    const installIdx = updaterSrc.indexOf("quitAndInstall");
    expect(cancelIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(cancelIdx);
    expect(updaterSrc).toMatch(/setAppIsQuitting\(true\)/);
  });
});
