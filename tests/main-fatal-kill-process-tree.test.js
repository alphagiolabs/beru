import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: fatal uncaughtException / unhandledRejection used bare
 * proc.kill(), which on Windows does not kill grandchild ffmpeg.exe.
 * onFatalError must use the shared killProcessTree helper (taskkill /F /T).
 */

const mainSrc = fs.readFileSync(path.join(process.cwd(), "main", "main.js"), "utf-8");
const utilSrc = fs.readFileSync(
  path.join(process.cwd(), "main", "utils", "kill-process-tree.js"),
  "utf-8",
);
const processSrc = fs.readFileSync(
  path.join(process.cwd(), "main", "handlers", "process.js"),
  "utf-8",
);

describe("fatal kill process tree", () => {
  it("onFatalError uses killProcessTree, not bare proc.kill", () => {
    const fatalIdx = mainSrc.indexOf("function onFatalError");
    expect(fatalIdx).toBeGreaterThan(-1);
    const afterFatal = mainSrc.slice(fatalIdx);
    const quitIdx = afterFatal.indexOf("app.quit()");
    expect(quitIdx).toBeGreaterThan(-1);
    const fatalBody = afterFatal.slice(0, quitIdx);
    expect(fatalBody).toMatch(/killProcessTree\(/);
    expect(fatalBody).not.toMatch(/proc\.kill\(/);
  });

  it("imports shared killProcessTree helper", () => {
    expect(mainSrc).toMatch(
      /import\s*\{\s*killProcessTree\s*\}\s*from\s*["']\.\/utils\/kill-process-tree\.js["']/,
    );
  });

  it("shared helper uses taskkill /F /T on win32", () => {
    expect(utilSrc).toMatch(/export\s+function\s+killProcessTree/);
    expect(utilSrc).toMatch(/win32/);
    expect(utilSrc).toMatch(/taskkill/);
    expect(utilSrc).toMatch(/\/F/);
    expect(utilSrc).toMatch(/\/T/);
  });

  it("cancel path reuses the shared helper", () => {
    expect(processSrc).toMatch(
      /import\s*\{\s*killProcessTree\s*\}\s*from\s*["']\.\.\/utils\/kill-process-tree\.js["']/,
    );
    expect(processSrc).toMatch(/killProcessTree\(proc\)/);
    expect(processSrc).not.toMatch(/function\s+killProcessTree/);
  });
});
