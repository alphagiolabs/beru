import { afterEach, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { estimateJobRamMb, resolveBatchWorkers } from "../main/workerPolicy.js";

afterEach(() => vi.restoreAllMocks());

it("loads capacity policy from the resources selected by the packaged processor spec", () => {
  const result = spawnSync(
    "python",
    [
      "-B",
      "-c",
      `
import sys, runpy, shutil, tempfile
from pathlib import Path
from types import SimpleNamespace
def analysis(*args, **kwargs):
    return SimpleNamespace(pure=[], zipped_data=[], scripts=[], binaries=[], zipfiles=[], datas=kwargs["datas"])
spec = runpy.run_path("python/beru-processor.spec", init_globals={
    "SPECPATH": str(Path("python").resolve()), "Analysis": analysis,
    "PYZ": lambda *args, **kwargs: None, "EXE": lambda *args, **kwargs: None,
    "COLLECT": lambda *args, **kwargs: None})
with tempfile.TemporaryDirectory(prefix="beru-policy-test-") as directory:
    for source, destination in spec["datas"]:
        target = Path(directory) / destination
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    sys.frozen = True
    sys._MEIPASS = directory
    sys.path.insert(0, "python")
    import capacity
    print(capacity.resolve_max_workers("h264_nvenc", 8, consider_memory=False, env={}))
`,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("5");
});

it("keeps JS worker recommendations and Python admission policy equivalent", () => {
  vi.spyOn(os, "cpus").mockReturnValue(Array.from({ length: 8 }, () => ({})));
  const cases = [
    { hwEncoder: "h264_nvenc", availableRamMb: 8192 },
    { hwEncoder: null, availableRamMb: 2048 },
    {
      hwEncoder: "h264_nvenc",
      availableRamMb: 4096,
      encodeProfile: "quality",
      hasVideoFilters: true,
      job: { videoCodec: "hevc", pixFmt: "yuv420p10le", sourceWidth: 3840, sourceHeight: 2160 },
    },
    { hwEncoder: "h264_mf", availableRamMb: 8192 },
  ].map((value) => ({ encodeProfile: "balanced", hasVideoFilters: false, job: {}, ...value }));
  const expected = [
    [256, 5],
    [512, 3],
    [1800, 1],
    [64, 1],
  ];
  const js = cases.map((input) => [
    estimateJobRamMb({ ...input, ...input.job }),
    resolveBatchWorkers({
      ...input,
      jobCount: 8,
      maxSourcePixels: (input.job.sourceWidth || 0) * (input.job.sourceHeight || 0),
      jobEntries: [input.job],
    }),
  ]);
  expect(js).toEqual(expected);
  const result = spawnSync(
    "python",
    [
      "-B",
      "-c",
      `
import sys, json
from unittest.mock import patch
sys.path.insert(0, "python")
import capacity
results = []
for value in json.load(sys.stdin):
    entry = value["job"]
    job = {"video_codec": entry.get("videoCodec", ""), "pix_fmt": entry.get("pixFmt", ""),
           "source_width": entry.get("sourceWidth", 0), "source_height": entry.get("sourceHeight", 0)}
    with patch("capacity.os.cpu_count", return_value=8), patch("capacity.get_available_ram_mb", return_value=value["availableRamMb"]):
        ram = capacity.estimate_job_ram_mb(job, value["hwEncoder"], value["hasVideoFilters"], value["encodeProfile"])
        workers = capacity.resolve_max_workers(value["hwEncoder"], 8, job["source_width"] * job["source_height"],
            has_video_filters=value["hasVideoFilters"], encode_profile=value["encodeProfile"], jobs=[job], env={})
        results.append([ram, workers])
print(json.dumps(results))
`,
    ],
    { input: JSON.stringify(cases), encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(expected);
});
