import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [matrixPath, repeatsArg = "3", idleArg = "5"] = process.argv.slice(2);
const repeats = Number(repeatsArg);
const idleSeconds = Number(idleArg);
if (
  process.platform !== "win32" ||
  !matrixPath ||
  !Number.isInteger(repeats) ||
  repeats < 1 ||
  !Number.isFinite(idleSeconds) ||
  idleSeconds < 1
) {
  throw new Error(
    "Usage (Windows): node scripts/benchmark-memory.mjs matrix.json [repeats=3] [idleSeconds=5]",
  );
}
const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
if (
  !["real", "synthetic"].includes(matrix.provenance) ||
  !Array.isArray(matrix.scenarios) ||
  !matrix.scenarios.length ||
  matrix.scenarios.some((s) => !s.name || !Array.isArray(s.jobs) || !s.jobs.length)
) {
  throw new Error(
    "Matrix needs provenance (real | synthetic) and nonempty named scenarios with jobs",
  );
}
const output = fs.mkdtempSync(path.join(os.tmpdir(), "beru-memory-"));
const ffprobe = path.join(root, "bin", "ffprobe.exe");
const probe = (file) =>
  JSON.parse(
    execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], {
      encoding: "utf8",
    }),
  );
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scenarios = matrix.scenarios.map((scenario, i) => ({
  name: scenario.name,
  jobs: scenario.jobs.map((job, j) => {
    const input = path.resolve(path.dirname(path.resolve(matrixPath)), job.input_path);
    const info = probe(input);
    const video = info.streams.find((s) => s.codec_type === "video");
    const audio = info.streams.find((s) => s.codec_type === "audio");
    if (!video) throw new Error(`Scenario ${scenario.name} job ${j}: video stream required`);
    return {
      ...job,
      id: j,
      input_path: input,
      output_path: path.join(output, `scenario-${i}-job-${j}.mp4`),
      source_width: video.width,
      source_height: video.height,
      video_codec: video.codec_name,
      pix_fmt: video.pix_fmt,
      video_duration: Number(video.duration || info.format.duration),
      audio_codec: audio?.codec_name || "",
      audio_channels: audio?.channels || 0,
    };
  }),
}));
const env = {
  ...process.env,
  BERU_WORKERS: "0",
  BERU_COPY_WORKERS: "0",
  BERU_WORKERS_MODE: "balanced",
  BERU_RETRY_FAILED: "0",
  BERU_FFMPEG: path.join(root, "bin", "ffmpeg.exe"),
  BERU_FFPROBE: ffprobe,
};
const report = {
  provenance: matrix.provenance,
  started: new Date().toISOString(),
  repeats,
  idleSeconds,
  output,
  runs: [],
};
const log = fs.createWriteStream(path.join(output, "processor.log"));
const worker = spawn(
  process.env.BERU_BENCH_PYTHON || "python",
  [path.join(root, "python", "processor.py"), "--job-worker"],
  { cwd: root, env, windowsHide: true },
);
const workerExit = once(worker, "exit");
worker.stderr.pipe(log, { end: false });
const lines = createInterface({ input: worker.stdout });
let pending;
lines.on("line", (line) => {
  log.write(line + "\n");
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (pending) {
    pending.events.push(event);
    if (event.type === pending.type) {
      const done = pending;
      pending = null;
      done.resolve(done.events);
    }
  }
});
const expect = (type, send) =>
  new Promise((resolve, reject) => {
    pending = { type, resolve, reject, events: [] };
    send?.();
  });
worker.on("error", (error) => {
  pending?.reject(error);
  pending = null;
});
worker.on("exit", (code) => {
  pending?.reject(new Error(`Worker exited (${code})`));
  pending = null;
});
let sampler;
try {
  const ready = await expect("ready");
  if (!ready.at(-1).ok) throw new Error("Processor initialization failed");
  sampler = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", "performance", "sample-memory.ps1"),
      "-RootPid",
      String(worker.pid),
      "-Output",
      path.join(output, "memory.jsonl"),
    ],
    { windowsHide: true },
  );
  const sampleErrors = [];
  sampler.stderr.on("data", (data) => sampleErrors.push(String(data)));
  await Promise.race([
    once(sampler.stdout, "data"),
    once(sampler, "exit").then(() => {
      throw new Error(`Memory sampler failed: ${sampleErrors.join("")}`);
    }),
  ]);
  await delay(idleSeconds * 1000);
  report.baselineEnd = Date.now();
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      const manifest = path.join(output, `jobs-${i}.json`);
      fs.writeFileSync(manifest, JSON.stringify(scenario.jobs));
      const run = {
        name: scenario.name,
        repeat,
        started: Date.now(),
        jobs: scenario.jobs,
        events: [],
      };
      report.runs.push(run);
      run.events = await expect("run_end", () =>
        worker.stdin.write(
          JSON.stringify({ id: report.runs.length, jobs_file: manifest, env: {} }) + "\n",
        ),
      );
      run.ended = Date.now();
      const summary = run.events.find((event) => event.type === "summary");
      if (
        !run.events.at(-1).ok ||
        summary?.succeeded !== scenario.jobs.length ||
        summary.failed ||
        summary.cancelled
      ) {
        throw new Error(`Processor failed in ${scenario.name}; see processor.log`);
      }
      run.outputs = scenario.jobs.map((job) => {
        const info = probe(job.output_path);
        if (
          !info.streams.some((s) => s.codec_type === "video") ||
          !(Number(info.format.duration) > 0)
        ) {
          throw new Error(`Invalid output for ${scenario.name}`);
        }
        if (job.audio_channels && !info.streams.some((s) => s.codec_type === "audio")) {
          throw new Error(`Audio lost in ${scenario.name}`);
        }
        return info;
      });
      await delay(idleSeconds * 1000);
      run.idleEnded = Date.now();
      console.log(
        `${scenario.name} #${repeat + 1}: ${((run.ended - run.started) / 1000).toFixed(2)}s`,
      );
    }
  }
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  if (worker.exitCode === null && !worker.killed) worker.stdin.end();
  await workerExit;
  if (sampler && sampler.exitCode === null) await once(sampler, "exit");
  log.end();
  await once(log, "finish");
  lines.close();
  const samplesPath = path.join(output, "memory.jsonl");
  const samples = fs.existsSync(samplesPath)
    ? fs
        .readFileSync(samplesPath, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  const summarize = (from, to) => {
    const series = samples.filter((s) => s.stamp >= from && s.stamp <= to);
    const sum = (s, key) => s.processes.reduce((n, p) => n + p[key], 0);
    return {
      samples: series.length,
      peakRssMiB: Math.max(0, ...series.map((s) => sum(s, "rss") / 1048576)),
      peakPrivateMiB: Math.max(0, ...series.map((s) => sum(s, "private") / 1048576)),
      peakSingleFfmpegPrivateMiB: Math.max(
        0,
        ...series.flatMap((s) =>
          s.processes
            .filter((p) => p.name.toLowerCase() === "ffmpeg.exe")
            .map((p) => p.private / 1048576),
        ),
      ),
      maxFfmpegProcesses: Math.max(
        0,
        ...series.map(
          (s) => s.processes.filter((p) => p.name.toLowerCase() === "ffmpeg.exe").length,
        ),
      ),
      minimumAvailableMiB: series.length
        ? Math.min(...series.map((s) => Math.min(s.availablePhysical, s.availableCommit) / 1048576))
        : null,
      maxIntervalMs:
        series.length > 1
          ? Math.max(...series.slice(1).map((s, i) => s.stamp - series[i].stamp))
          : null,
    };
  };
  report.baseline = summarize(0, report.baselineEnd || 0);
  report.policyDecisions = fs
    .readFileSync(path.join(output, "processor.log"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("Starting batch:"));
  for (const run of report.runs) {
    run.processing = summarize(run.started, run.ended || Date.now());
    run.idle = summarize((run.idleEnded || 0) - idleSeconds * 500, run.idleEnded || 0);
    if (!run.processing.samples)
      report.failure ||= "A processing run escaped the sampler; increase clip duration";
  }
  if (report.failure) process.exitCode = 1;
  report.ended = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Evidence: ${output}`);
  if (report.failure) console.error(report.failure);
}
