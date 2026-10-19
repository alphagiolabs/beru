import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { validateCompositionJob, COMPOSITION_LIMITS } from "../shared/composition-settings.js";

it("enforces the same composition boundaries in JavaScript and the standalone processor", () => {
  const clip = {
    input_path: "C:/Videos/a.mp4",
    video_duration: 10,
    trim_start: 1,
    trim_end: 6,
    playback_rate: 1,
    repeat_count: 1,
    audio_muted: false,
  };
  const valid = {
    kind: "composition",
    canvas: { width: 640, height: 360, fit: "contain" },
    composition_fps: 30,
    clips: [clip],
  };
  const cases = [
    valid,
    { ...valid, composition_fps: 300 },
    { ...valid, clips: Array.from({ length: COMPOSITION_LIMITS.maxClips + 1 }, () => clip) },
    { ...valid, canvas: { ...valid.canvas, width: 9000 } },
    { ...valid, canvas: { ...valid.canvas, height: true } },
    { ...valid, clips: [{ ...clip, playback_rate: 5 }] },
    { ...valid, clips: [{ ...clip, trim_start: true }] },
    { ...valid, frame: { atUs: 5e6 } },
  ];
  const script =
    "import json,sys;sys.path.insert(0,'python');from composition_limits import validate_composition_job\nresults=[]\nfor job in json.load(sys.stdin):\n try: validate_composition_job(job);results.append(True)\n except Exception: results.append(False)\nprint(json.dumps(results))";
  const result = spawnSync("python", ["-c", script], {
    input: JSON.stringify(cases),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  const accepted = cases.map((job) => validateCompositionJob(job) == null);
  expect(accepted).toEqual([true, false, false, false, false, false, false, false]);
  expect(JSON.parse(result.stdout)).toEqual(accepted);
});
