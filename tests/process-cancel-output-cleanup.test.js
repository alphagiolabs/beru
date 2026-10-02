import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { removeIncompleteOutput } from "../main/utils/process-output.js";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

const { createCancelArtifacts, sweepOrphanedArtifacts } =
  await import("../main/utils/cancel-artifacts.js");

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

describe("cancel artifacts (interface)", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-artifacts-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    tmpDir = null;
  });

  it("creates a manifest path inside a private beru-jobs dir under temp", async () => {
    const artifacts = await createCancelArtifacts(tmpDir);
    const dir = path.dirname(artifacts.manifestPath);

    expect(path.basename(dir)).toMatch(/^beru-jobs-/);
    expect(path.dirname(dir)).toBe(tmpDir);
    expect(path.basename(artifacts.manifestPath)).toBe("manifest.json");
    expect(artifacts.isCancelled()).toBe(false);

    artifacts.dispose();
  });

  it("markCancelled writes the <stem>.cancel sentinel the processor polls", async () => {
    const artifacts = await createCancelArtifacts(tmpDir);
    const sentinel = path.join(path.dirname(artifacts.manifestPath), "manifest.cancel");

    fs.writeFileSync(artifacts.manifestPath, "{}");
    artifacts.markCancelled();

    expect(artifacts.isCancelled()).toBe(true);
    expect(fs.existsSync(sentinel)).toBe(true);
    expect(fs.readFileSync(sentinel, "utf-8")).toBe("1");

    artifacts.dispose();
  });

  it("dispose removes manifest, sentinel and the private dir, idempotently", async () => {
    const artifacts = await createCancelArtifacts(tmpDir);
    const dir = path.dirname(artifacts.manifestPath);
    fs.writeFileSync(artifacts.manifestPath, "{}");
    artifacts.markCancelled();

    artifacts.dispose();
    artifacts.dispose();

    expect(fs.existsSync(dir)).toBe(false);
  });

  it("dispose tolerates a run cancelled before the manifest was written", async () => {
    const artifacts = await createCancelArtifacts(tmpDir);
    expect(artifacts.isCancelled()).toBe(false);
    artifacts.markCancelled();
    artifacts.dispose();
    expect(fs.existsSync(path.dirname(artifacts.manifestPath))).toBe(false);
  });

  it("sweepOrphanedArtifacts drops beru-jobs leftovers and nothing else", async () => {
    const orphanDir = fs.mkdtempSync(path.join(tmpDir, "beru-jobs-"));
    fs.writeFileSync(path.join(orphanDir, "manifest.json"), "{}");
    fs.writeFileSync(path.join(orphanDir, "manifest.cancel"), "1");
    fs.writeFileSync(path.join(tmpDir, "beru-jobs-flat.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "beru-jobs-flat.cancel"), "1");
    fs.writeFileSync(path.join(tmpDir, "keep.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "keep.cancel"), "1");
    fs.mkdirSync(path.join(tmpDir, "other-dir"));

    sweepOrphanedArtifacts(tmpDir);

    const remaining = fs.readdirSync(tmpDir).sort();
    expect(remaining).toEqual(["keep.cancel", "keep.json", "other-dir"]);
  });
});
