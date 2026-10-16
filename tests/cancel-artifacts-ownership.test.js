import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const { createCancelArtifacts, sweepOrphanedArtifacts } =
  await import("../main/utils/cancel-artifacts.js");

describe("scratch sweep ownership", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
      tmpDir = null;
    }
  });

  const makeScratch = (name, ownerPid, markerContent) => {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
    if (markerContent !== undefined) {
      fs.writeFileSync(path.join(dir, "owner.json"), markerContent);
    } else if (ownerPid !== undefined) {
      fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ pid: ownerPid }));
    }
    return dir;
  };

  it("preserves the scratch of another live instance", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-ownership-"));
    const alien = makeScratch("beru-jobs-alien", 4242);

    sweepOrphanedArtifacts(tmpDir, { isPidAlive: () => true });

    expect(fs.existsSync(alien)).toBe(true);
    expect(fs.existsSync(path.join(alien, "manifest.json"))).toBe(true);
  });

  it("removes the scratch of another instance once its pid is dead", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-ownership-"));
    const dead = makeScratch("beru-jobs-dead", 4242);

    sweepOrphanedArtifacts(tmpDir, { isPidAlive: () => false });

    expect(fs.existsSync(dead)).toBe(false);
  });

  it("still sweeps legacy directories without an owner marker", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-ownership-"));
    const legacy = makeScratch("beru-jobs-legacy", undefined);
    const previewLegacy = makeScratch("beru-preview-legacy", undefined);

    sweepOrphanedArtifacts(tmpDir, { isPidAlive: () => true });

    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(previewLegacy)).toBe(false);
  });

  it("removes our own live scratch even when the pid is alive", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-ownership-"));
    const own = makeScratch("beru-jobs-own", process.pid);

    sweepOrphanedArtifacts(tmpDir, { isPidAlive: () => true });

    expect(fs.existsSync(own)).toBe(false);
  });

  it("treats a corrupted owner marker as a legacy orphan", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-ownership-"));
    const corrupted = makeScratch("beru-preview-corrupted", undefined, "{not json");

    sweepOrphanedArtifacts(tmpDir, { isPidAlive: () => true });

    expect(fs.existsSync(corrupted)).toBe(false);
  });

  it("createCancelArtifacts stamps owner.json with the current pid", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-ownership-"));

    const artifacts = await createCancelArtifacts(tmpDir);

    const marker = JSON.parse(
      fs.readFileSync(path.join(path.dirname(artifacts.manifestPath), "owner.json"), "utf8"),
    );
    expect(marker.pid).toBe(process.pid);
  });
});
