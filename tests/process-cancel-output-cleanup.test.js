import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { removeIncompleteOutput } from "../main/utils/process-output.js";

/**
 * Cancel must delete incomplete outputs after force-kill, never completed
 * outputs or inputs, and never paths outside the output root.
 */

const processSrc = fs.readFileSync(
  path.join(process.cwd(), "main", "handlers", "process.js"),
  "utf-8",
);

describe("removeIncompleteOutput", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
      tmpDir = null;
    }
  });

  it("deletes a file under the output root", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-cancel-out-"));
    const outputRoot = path.join(tmpDir, "out");
    const inputPath = path.join(tmpDir, "in", "source.mp4");
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, "input");
    const partial = path.join(outputRoot, "partial.mp4");
    fs.writeFileSync(partial, "truncated");

    expect(removeIncompleteOutput(partial, { outputRoot, inputPath })).toBe(true);
    expect(fs.existsSync(partial)).toBe(false);
    expect(fs.existsSync(inputPath)).toBe(true);
  });

  it("refuses paths outside the output root", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-cancel-out-"));
    const outputRoot = path.join(tmpDir, "out");
    const outside = path.join(tmpDir, "elsewhere", "leak.mp4");
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, "secret");

    expect(removeIncompleteOutput(outside, { outputRoot, inputPath: null })).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("refuses deleting the input path even when under the output root", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-cancel-out-"));
    const outputRoot = path.join(tmpDir, "out");
    fs.mkdirSync(outputRoot, { recursive: true });
    const samePath = path.join(outputRoot, "clip.mp4");
    fs.writeFileSync(samePath, "data");

    expect(removeIncompleteOutput(samePath, { outputRoot, inputPath: samePath })).toBe(false);
    expect(fs.existsSync(samePath)).toBe(true);
  });
});

describe("cancel incomplete-output cleanup wiring (source)", () => {
  it("caps cancel kill grace at <=1500ms and waits before killProcessTree", () => {
    expect(processSrc).toMatch(/CANCEL_KILL_GRACE_MS\s*=\s*1500\b/);
    const cancelFn = processSrc.slice(
      processSrc.indexOf("export async function cancelActiveProcessing"),
      processSrc.indexOf("export function registerProcessHandlers"),
    );
    const graceIdx = cancelFn.indexOf("waitForProcessClose(proc, CANCEL_KILL_GRACE_MS)");
    const killIdx = cancelFn.indexOf("killProcessTree(proc)");
    expect(graceIdx).toBeGreaterThan(-1);
    expect(killIdx).toBeGreaterThan(graceIdx);
  });

  it("snapshots job outputs at spawn and tracks type:complete only", () => {
    expect(processSrc).toMatch(/snapshotRunOutputsForCancel\(/);
    const spawnIdx = processSrc.indexOf("spawn(spawnSpec.command");
    expect(spawnIdx).toBeGreaterThan(-1);
    const afterSpawn = processSrc.slice(spawnIdx, spawnIdx + 800);
    expect(afterSpawn).toMatch(/snapshotRunOutputsForCancel\(/);

    expect(processSrc).toMatch(/markJobOutputComplete/);
    expect(processSrc).toMatch(/msg\.type === "complete"/);
    // Keep-set must not rely on cancelled NDJSON (not on main yet).
    const cancelFn = processSrc.slice(
      processSrc.indexOf("export async function cancelActiveProcessing"),
      processSrc.indexOf("export function registerProcessHandlers"),
    );
    expect(cancelFn).not.toMatch(/type\s*===\s*["']cancelled["']/);
    expect(cancelFn).toMatch(/cleanupIncompleteOutputsAfterCancel/);
  });

  it("cleanup uses removeIncompleteOutput and completedIndices keep-set", () => {
    expect(processSrc).toMatch(/removeIncompleteOutput/);
    expect(processSrc).toMatch(/completedIndices/);
    expect(processSrc).toMatch(/cleanupIncompleteOutputsAfterCancel/);
  });
});
