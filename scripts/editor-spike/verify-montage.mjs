import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readBarcodes, readClickOnsets } from "./io.mjs";
import {
  addAsset,
  insertClip,
  layoutTrack,
  moveClip,
  setCanvas,
  splitClip,
} from "../../shared/editor-timeline.js";
import { createEmptyEditorProject } from "../../shared/editor-project.js";
import { buildCompositionManifest } from "../../src/features/editor/composition.js";

const FIXTURES = path.resolve(".tmp/editor-f0/fixtures");
const OUT_DIR = path.resolve(".tmp/editor-f3");
const FPS = 30;
const W = 854;
const H = 480;
const SECOND = 1_000_000;
mkdirSync(OUT_DIR, { recursive: true });

const source = (name, seconds, fps) => {
  const file = path.join(FIXTURES, name);
  const stat = statSync(file);
  return {
    path: file,
    filename: name,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    metadata: { durationUs: seconds * SECOND, width: 640, height: 360, fps },
  };
};

function montage() {
  let project = setCanvas(createEmptyEditorProject(), { width: W, height: H });
  const a = addAsset(project, source("cfr-30.mp4", 8, 30));
  project = insertClip(a.project, {
    assetId: a.assetId,
    sourceInUs: 1 * SECOND,
    sourceOutUs: 6 * SECOND,
  }).project;
  const b = addAsset(project, source("cfr-25.mp4", 8, 25));
  project = insertClip(b.project, {
    assetId: b.assetId,
    sourceInUs: 0,
    sourceOutUs: 5 * SECOND,
  }).project;
  return { project, a: a.assetId, b: b.assetId };
}

// Source frame each output frame of one clip must show: the fps filter's nearest frame, with exact
// half-frame ties going to the earlier frame (measured in F0).
function expectedFrames(clip, srcFps) {
  const count = Math.round(((clip.outUs - clip.inUs) / SECOND) * FPS);
  return Array.from({ length: count }, (_, j) => {
    const numerator = 2 * ((clip.inUs * FPS) / SECOND + j) * srcFps - FPS;
    return Math.ceil(numerator / (2 * FPS));
  });
}

function exportProject(name, project) {
  const manifest = buildCompositionManifest(project, {
    audio: "original",
    encodeProfile: "balanced",
  });
  manifest.jobs[0].output_path = path.join(OUT_DIR, `${name}.mp4`);
  const manifestPath = path.join(OUT_DIR, `${name}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const run = spawnSync("python", ["processor.py", manifestPath], {
    cwd: "python",
    encoding: "utf8",
  });
  const complete = run.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((m) => m.type === "complete");
  if (run.status !== 0 || !complete)
    throw new Error(`export ${name} failed: ${run.stdout}${run.stderr}`);
  return { file: manifest.jobs[0].output_path, manifest };
}

const failures = [];
function check(label, condition, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures.push(label);
}

function verifyFrames(label, file, expected, offset = 0) {
  const frames = readBarcodes(file, { bitWidth: (32 * W) / 640, height: (32 * H) / 360, bits: 10 });
  let mismatches = 0;
  expected.forEach((value, j) => {
    if (frames[offset + j] !== value) mismatches += 1;
  });
  check(
    `${label}: frame count`,
    frames.length === expected.length,
    `${frames.length} of ${expected.length}`,
  );
  check(`${label}: every frame matches`, mismatches === 0, `${mismatches} mismatches`);
  return frames;
}

const base = montage();
const first = exportProject("ab", base.project);
const aFrames = expectedFrames({ inUs: 1 * SECOND, outUs: 6 * SECOND }, 30);
const bFrames = expectedFrames({ inUs: 0, outUs: 5 * SECOND }, 25);
const order = layoutTrack(base.project).map((e) => e.clip.id);
check("montage keeps the two clips in order", order.length === 2);
verifyFrames("A then B", first.file, [...aFrames, ...bFrames]);
const clicks = readClickOnsets(first.file);
const expectedClicks = Array.from({ length: 10 }, (_, s) => s);
const clickErrors = expectedClicks.map((t) => {
  const nearest = clicks.reduce(
    (best, c) => (best === null || Math.abs(c - t) < Math.abs(best - t) ? c : best),
    null,
  );
  return nearest === null ? Infinity : Math.abs(nearest - t) * 1000;
});
check(
  "clicks land on the montage timeline (10 clicks, within 0.1 ms)",
  clicks.length === 10 && Math.max(...clickErrors) <= 0.1,
  `${clicks.length} clicks, max ${Math.max(...clickErrors).toFixed(3)} ms`,
);

const reordered = moveClip(base.project, layoutTrack(base.project)[0].clip.id, 1);
const second = exportProject("ba", reordered);
verifyFrames("B then A (reordered)", second.file, [...bFrames, ...aFrames]);
check(
  "reordering changes the exported first frame",
  readBarcodes(second.file, { bitWidth: (32 * W) / 640, height: (32 * H) / 360 })[0] === bFrames[0],
);

const splitAt = 3 * SECOND;
const clipA = layoutTrack(base.project)[0];
const split = splitClip(base.project, clipA.clip.id, splitAt);
const third = exportProject("ab-split", split.project);
verifyFrames("A split at 3 s, then B", third.file, [...aFrames, ...bFrames]);

console.log(
  failures.length === 0
    ? "\nF3 montage verification: all checks passed"
    : `\nF3 montage verification: ${failures.length} check(s) failed`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
