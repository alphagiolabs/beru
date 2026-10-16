import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRunOutputFiles, findExistingOutputs } from "../main/utils/process-output.js";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

let outputDir;

beforeEach(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-promotion-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(outputDir, { recursive: true, force: true });
});

function stageRun(names, options) {
  const run = createRunOutputFiles(
    names.map((name, id) => ({ id, output_path: path.join(outputDir, name) })),
    outputDir,
    options,
  );
  run.jobs.forEach((job, id) => fs.writeFileSync(job.output_path, `export-${id}`));
  return run;
}

describe("findExistingOutputs", () => {
  it("lists only outputs that already exist on disk", async () => {
    const existing = path.join(outputDir, "clip_beru.mp4");
    fs.writeFileSync(existing, "previous work");
    const jobs = [{ output_path: existing }, { output_path: path.join(outputDir, "new.mp4") }];

    expect(await findExistingOutputs(jobs)).toEqual([existing]);
  });
});

describe("createRunOutputFiles promotion", () => {
  it("never replaces a destination even when existence checks report it as free", async () => {
    const run = stageRun(["clip.mp4"]);
    const target = path.join(outputDir, "clip.mp4");
    const exists = fs.existsSync;
    fs.writeFileSync(target, "another export");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === target) return false;
      return exists(candidate);
    });
    const output = await run.complete(0);
    expect(fs.readFileSync(target, "utf8")).toBe("another export");
    expect(output).toBe(path.join(outputDir, "clip__2.mp4"));
    expect(fs.readFileSync(output, "utf8")).toBe("export-0");
    run.dispose();
  });

  it("never replaces a file that appeared after the preflight", async () => {
    const run = stageRun(["clip_beru.mp4"]);
    const target = path.join(outputDir, "clip_beru.mp4");
    fs.writeFileSync(target, "previous work");

    const output = await run.complete(0);

    expect(output).toBe(path.join(outputDir, "clip_beru__2.mp4"));
    expect(fs.readFileSync(target, "utf8")).toBe("previous work");
    expect(fs.readFileSync(output, "utf8")).toBe("export-0");
    run.dispose();
  });

  it("skips names reserved by other jobs of the same run", async () => {
    const run = stageRun(["clip.mp4", "clip__2.mp4"]);
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "previous work");

    expect(await run.complete(0)).toBe(path.join(outputDir, "clip__3.mp4"));
    expect(await run.complete(1)).toBe(path.join(outputDir, "clip__2.mp4"));
    run.dispose();
  });

  it("replaces the destination when overwrite was confirmed", async () => {
    const run = stageRun(["clip_beru.mp4"], { overwrite: true });
    const target = path.join(outputDir, "clip_beru.mp4");
    fs.writeFileSync(target, "previous work");

    expect(await run.complete(0)).toBe(target);
    expect(fs.readFileSync(target, "utf8")).toBe("export-0");
    run.dispose();
  });

  it("keeps the export under a free name when the destination cannot be replaced", async () => {
    const run = stageRun(["locked.mp4"], { overwrite: true });
    fs.mkdirSync(path.join(outputDir, "locked.mp4"));

    const output = await run.complete(0);

    expect(output).toBe(path.join(outputDir, "locked__2.mp4"));
    expect(fs.readFileSync(output, "utf8")).toBe("export-0");
    run.dispose();
  });

  it("preserves the staged export when no destination accepts it", async () => {
    const run = stageRun(["clip.mp4"], { overwrite: true });
    const staged = run.jobs[0].output_path;
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("EPERM");
    });
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      throw new Error("EPERM");
    });
    vi.spyOn(fs.promises, "copyFile").mockImplementation(() => {
      throw new Error("EPERM");
    });

    await expect(run.complete(0)).rejects.toThrow(staged);
    run.dispose();

    expect(fs.readFileSync(staged, "utf8")).toBe("export-0");
  });

  it("exports on volumes that do not support hard links", async () => {
    const run = stageRun(["clip.mp4"]);
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      throw Object.assign(new Error("Not supported"), { code: "ENOTSUP" });
    });
    const output = await run.complete(0);
    expect(fs.readFileSync(output, "utf8")).toBe("export-0");
    run.dispose();
    expect(fs.readdirSync(outputDir)).toEqual(["clip.mp4"]);
  });
});
