import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { fingerprintJob } from "./job-fingerprints.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [matrixFile, outputArg, repeatsArg = "3"] = process.argv.slice(2);
if (process.platform !== "win32" || !matrixFile || !outputArg)
  throw new Error(
    "Usage: node scripts/performance/audit-jobs.mjs matrix.json new-output-dir [repeats=3]",
  );
const output = path.resolve(outputArg);
const matrix = JSON.parse(fs.readFileSync(matrixFile, "utf8"));
if (matrix.processor && matrix.processor !== "packaged") throw new Error("Unknown processor mode");
const packaged = matrix.processor === "packaged";
if (matrix.batch && packaged) throw new Error("Batch instrumentation requires the source worker");
if (matrix.batch && (!Number.isInteger(matrix.batch.workers) || matrix.batch.workers < 1))
  throw new Error("Batch workers must be a positive integer");
const repeats = Number(repeatsArg);
if (!Number.isInteger(repeats) || repeats < 1) throw new Error("Invalid repeats");
const allowedVariants = new Set([
  "baseline",
  "decode2",
  "decode4",
  "gray-buffer",
  "motion-grid",
  "exit-wait",
  "copy-buffer",
  "poll-wait",
  "allocating-copy",
  "pre-optimizations",
]);
if (matrix.control && !allowedVariants.has(matrix.control)) throw new Error("Unknown control");
if (!Array.isArray(matrix.scenarios) || !matrix.scenarios.length) throw new Error("No scenarios");
for (const scenario of matrix.scenarios) {
  for (const variant of scenario.variants || ["baseline", "decode2", "decode4"]) {
    if (!allowedVariants.has(variant) || (packaged && variant !== "baseline"))
      throw new Error(`Unsupported variant: ${variant}`);
  }
  if (packaged && (scenario.profile || scenario.diagnostic))
    throw new Error("Packaged profiling and diagnostics are unsupported");
}
fs.mkdirSync(output);
const ffmpeg = path.join(root, "bin", "ffmpeg.exe");
const ffprobe = path.join(root, "bin", "ffprobe.exe");
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceHashes = () =>
  Object.fromEntries(
    fs
      .readdirSync(path.join(root, "python"))
      .filter((file) => file.endsWith(".py") && !file.startsWith("test_"))
      .map((file) => [file, hash(path.join(root, "python", file))]),
  );
const probe = (file) =>
  JSON.parse(
    execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    }),
  );
const python =
  process.env.BERU_BENCH_PYTHON || path.join(root, ".venv-processor", "Scripts", "python.exe");
const workerTemporary = path.join(output, "worker-temp");
fs.mkdirSync(workerTemporary);
const report = {
  started: new Date().toISOString(),
  matrix,
  repeats,
  output,
  environment: {
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    node: process.version,
    openblasNumThreads: process.env.OPENBLAS_NUM_THREADS || null,
    ffmpegSha256: hash(ffmpeg),
    processorSha256: hash(path.join(root, "python", "processor.py")),
    sourceSha256: sourceHashes(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  },
  runs: [],
  comparisons: [],
};
const jobs = matrix.scenarios.map((scenario) => {
  const input = path.resolve(path.dirname(path.resolve(matrixFile)), scenario.job.input_path);
  const info = probe(input);
  const video = info.streams.find((s) => s.codec_type === "video");
  const audio = info.streams.find((s) => s.codec_type === "audio");
  return {
    ...scenario,
    job: {
      ...scenario.job,
      input_path: input,
      id: 0,
      source_width: video.width,
      source_height: video.height,
      pix_fmt: video.pix_fmt,
      video_codec: video.codec_name,
      video_duration: Number(video.duration || info.format.duration),
      frame_rate:
        Number(video.avg_frame_rate.split("/")[0]) / Number(video.avg_frame_rate.split("/")[1]),
      video_info_probed: true,
      audio_codec: audio?.codec_name || "",
      audio_channels: audio?.channels || 0,
    },
  };
});
const worker = spawn(
  packaged ? path.join(root, "bin", "beru-processor.exe") : python,
  packaged ? ["--job-worker"] : [path.join(root, "scripts", "performance", "job-audit-worker.py")],
  {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      BERU_FFMPEG: ffmpeg,
      BERU_FFPROBE: ffprobe,
      TEMP: workerTemporary,
      TMP: workerTemporary,
    },
  },
);
const workerExit = once(worker, "exit");
report.environment.workerPid = worker.pid;
const log = fs.createWriteStream(path.join(output, "processor.log"));
worker.stderr.pipe(log, { end: false });
let pending;
const lines = createInterface({ input: worker.stdout });
lines.on("line", (line) => {
  log.write(line + "\n");
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (pending) pending.events.push(event);
  if (pending && event.type === pending.type) {
    clearTimeout(pending.deadline);
    const resolve = pending.resolve;
    const events = pending.events;
    pending = undefined;
    resolve(packaged ? { ...event, events } : event);
  }
});
const expect = (type, request) =>
  new Promise((resolve, reject) => {
    pending = {
      type,
      resolve,
      reject,
      events: [],
      deadline: setTimeout(() => reject(new Error(`Timeout ${type}`)), 300000),
    };
    if (request) worker.stdin.write(JSON.stringify(request) + "\n");
  });
worker.on("error", (error) => pending?.reject(error));
worker.on("exit", (code) => pending?.reject(new Error(`Worker exited ${code}`)));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sampler;
try {
  const ready = await expect(packaged ? "ready" : "audit_ready");
  if (packaged && !ready.ok) throw new Error("Packaged processor initialization failed");
  report.environment.python = ready.python;
  if (packaged)
    report.environment.packagedSha256 = hash(path.join(root, "bin", "beru-processor.exe"));
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
      "-IntervalMs",
      "50",
    ],
    { windowsHide: true },
  );
  const samplerErrors = [];
  sampler.stderr.on("data", (data) => samplerErrors.push(String(data)));
  await Promise.race([
    once(sampler.stdout, "data"),
    once(sampler, "exit").then(() => {
      throw new Error(`Sampler failed ${samplerErrors.join("")}`);
    }),
  ]);
  await delay(400);
  if (matrix.batch) {
    report.batches = [];
    const sessionStarted = Date.now();
    for (
      let repeat = 0;
      repeat < repeats || Date.now() - sessionStarted < (matrix.batch.minimumSeconds || 0) * 1000;
      repeat++
    ) {
      const batchJobs = jobs.map((scenario, index) => ({
        ...scenario.job,
        id: index,
        output_path: path.join(
          output,
          `${scenario.name}-baseline-${repeat}${scenario.extension || ".mp4"}`,
        ),
      }));
      const started = Date.now();
      const result = await expect("audit_batch_result", {
        jobs: batchJobs,
        variant: matrix.control || "baseline",
        hardware: matrix.batch.hardware,
        workers: matrix.batch.workers,
        serial: matrix.batch.serial,
      });
      if (result.failure || result.runs.length !== jobs.length)
        throw new Error(`Batch failed: ${JSON.stringify(result)}`);
      for (const measured of result.runs) {
        if (measured.failure || measured.result?.status !== "succeeded")
          throw new Error(`Job failed: ${JSON.stringify(measured)}`);
        const scenario = jobs[measured.job.id];
        report.runs.push({ ...measured, name: scenario.name, repeat, variant: "baseline" });
        console.log(`${scenario.name} #${repeat}: ${measured.seconds.toFixed(3)}s`);
      }
      report.batches.push({ repeat, started, ended: Date.now(), seconds: result.seconds });
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      const idleStarted = Date.now();
      await delay(matrix.batch.idleMs || 150);
      report.batches.at(-1).idle = { started: idleStarted, ended: Date.now() };
    }
    report.sessionSeconds = (Date.now() - sessionStarted) / 1000;
  } else
    for (const scenario of jobs) {
      const variants = scenario.variants || ["baseline", "decode2", "decode4"];
      for (let repeat = 0; repeat < (scenario.repeats || repeats); repeat++) {
        const ordered = repeat % 2 ? [...variants].reverse() : variants;
        for (const variant of ordered) {
          const label = `${scenario.name}-${variant}-${repeat}`;
          const job = {
            ...scenario.job,
            output_path: path.join(output, `${label}${scenario.extension || ".mp4"}`),
          };
          const started = Date.now();
          let result;
          if (packaged) {
            if (variant !== "baseline")
              throw new Error("Packaged experiments require environment variants");
            const manifest = path.join(output, `${label}.json`);
            fs.writeFileSync(manifest, JSON.stringify([job]));
            const event = await expect("run_end", {
              id: report.runs.length + 1,
              jobs_file: manifest,
              env: { BERU_WORKERS: "1", BERU_RETRY_FAILED: "0" },
            });
            const summary = event.events.find((item) => item.type === "summary");
            const succeeded =
              event.ok && summary?.succeeded === 1 && !summary.failed && !summary.cancelled;
            result = {
              result: { status: succeeded ? "succeeded" : "failed" },
              events: event.events,
              seconds: (Date.now() - started) / 1000,
              python_cpu_seconds: null,
              commands: [],
              phases: [],
            };
          } else
            result = await expect("audit_result", {
              job,
              variant: matrix.control || variant,
              hardware: scenario.hardware,
              diagnostic: scenario.diagnostic,
            });
          const run = {
            name: scenario.name,
            repeat,
            job,
            started,
            ended: Date.now(),
            ...result,
            variant,
          };
          report.runs.push(run);
          if (run.failure || run.result?.status !== "succeeded")
            throw new Error(`Job failed: ${label}: ${JSON.stringify(run)}`);
          console.log(
            `${label}: ${run.seconds.toFixed(3)}s; Python CPU ${run.python_cpu_seconds === null ? "unavailable" : `${run.python_cpu_seconds.toFixed(3)}s`}`,
          );
          fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
          await delay(150);
        }
      }
      if (scenario.profile) {
        const job = {
          ...scenario.job,
          output_path: path.join(output, `${scenario.name}-profile.mp4`),
        };
        report.profiles ||= [];
        report.profiles.push({
          name: scenario.name,
          ...(await expect("audit_result", {
            job,
            variant: "baseline",
            profile: path.join(output, `${scenario.name}.prof`),
            hardware: scenario.hardware,
          })),
        });
      }
    }
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  if (pending) clearTimeout(pending.deadline);
  worker.stdin.end();
  await workerExit;
  if (sampler && sampler.exitCode === null) await once(sampler, "exit");
  log.end();
  await once(log, "finish");
  lines.close();
  report.sourceSha256AtEnd = sourceHashes();
  report.sourceChangedDuringRun = [
    ...new Set([
      ...Object.keys(report.environment.sourceSha256),
      ...Object.keys(report.sourceSha256AtEnd),
    ]),
  ].filter((file) => report.environment.sourceSha256[file] !== report.sourceSha256AtEnd[file]);
  if (!packaged && report.sourceChangedDuringRun.length) {
    report.failure ||= `Source changed during measurements: ${report.sourceChangedDuringRun.join(", ")}`;
    process.exitCode = 1;
  }
  const samplesFile = path.join(output, "memory.jsonl");
  const samples = fs.existsSync(samplesFile)
    ? fs.readFileSync(samplesFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  for (const run of report.runs) {
    const series = samples.filter((s) => s.stamp >= run.started && s.stamp <= run.ended);
    const sum = (s, key) => s.processes.reduce((n, p) => n + p[key], 0) / 1048576;
    run.memory = {
      samples: series.length,
      peakRssMiB: Math.max(0, ...series.map((s) => sum(s, "rss"))),
      peakPrivateMiB: Math.max(0, ...series.map((s) => sum(s, "private"))),
      peakPythonPrivateMiB: Math.max(
        0,
        ...series.map(
          (s) =>
            s.processes
              .filter((p) => ["python.exe", "beru-processor.exe"].includes(p.name))
              .reduce((n, p) => n + p.private, 0) / 1048576,
        ),
      ),
      peakFfmpegPrivateMiB: Math.max(
        0,
        ...series.map(
          (s) =>
            s.processes.filter((p) => p.name === "ffmpeg.exe").reduce((n, p) => n + p.private, 0) /
            1048576,
        ),
      ),
      minAvailableMiB: series.length
        ? Math.min(...series.map((s) => Math.min(s.availablePhysical, s.availableCommit) / 1048576))
        : null,
      maxIntervalMs:
        series.length > 1
          ? Math.max(...series.slice(1).map((s, i) => s.stamp - series[i].stamp))
          : null,
    };
    const owned = new Set((run.commands || []).map((command) => command.pid));
    run.memory.peakOwnedChildrenPrivateMiB = Math.max(
      0,
      ...series.map(
        (s) =>
          s.processes.filter((p) => owned.has(p.pid)).reduce((n, p) => n + p.private, 0) / 1048576,
      ),
    );
    run.memory.peakOwnedChildrenRssMiB = Math.max(
      0,
      ...series.map(
        (s) => s.processes.filter((p) => owned.has(p.pid)).reduce((n, p) => n + p.rss, 0) / 1048576,
      ),
    );
  }
  for (const batch of report.batches || []) {
    const summarize = (start, end) => {
      const series = samples.filter((s) => s.stamp >= start && s.stamp <= end);
      return {
        samples: series.length,
        peakTreePrivateMiB: Math.max(
          0,
          ...series.map((s) => s.processes.reduce((n, p) => n + p.private, 0) / 1048576),
        ),
        peakTreeRssMiB: Math.max(
          0,
          ...series.map((s) => s.processes.reduce((n, p) => n + p.rss, 0) / 1048576),
        ),
        maxConcurrentJobs: Math.max(
          0,
          ...series.map(
            (s) =>
              report.runs.filter(
                (r) => r.repeat === batch.repeat && r.started <= s.stamp && r.ended >= s.stamp,
              ).length,
          ),
        ),
        processorPrivateMiB: series
          .map(
            (s) =>
              s.processes
                .filter((p) => ["python.exe", "beru-processor.exe"].includes(p.name))
                .reduce((n, p) => n + p.private, 0) / 1048576,
          )
          .filter(Number.isFinite),
      };
    };
    batch.memory = summarize(batch.started, batch.ended);
    if (batch.idle) batch.idle.memory = summarize(batch.idle.started, batch.idle.ended);
  }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
if (!report.failure) {
  const fingerprints = new Map();
  for (const run of report.runs.filter((item) => !item.diagnostic)) {
    const key = `${run.name}-${run.variant}-${run.repeat}`;
    run.decoded = fingerprintJob(run.job.output_path, key, { ffmpeg, ffprobe, output });
    fingerprints.set(key, run.decoded);
  }
  for (const run of report.runs.filter((r) => r.variant !== "baseline")) {
    const before = fingerprints.get(`${run.name}-baseline-${run.repeat}`);
    const after = fingerprints.get(`${run.name}-${run.variant}-${run.repeat}`);
    const equal =
      JSON.stringify(before.hashes.map(({ type, sha256 }) => ({ type, sha256 }))) ===
      JSON.stringify(after.hashes.map(({ type, sha256 }) => ({ type, sha256 })));
    report.comparisons.push({
      name: run.name,
      variant: run.variant,
      repeat: run.repeat,
      allDecodedFramesAndAudioExact: equal,
      before,
      after,
    });
    if (!equal) process.exitCode = 1;
    console.log(
      `${run.name} ${run.variant} #${run.repeat}: decoded video/audio ${equal ? "EXACT" : "DIFFERENT"}`,
    );
  }
}
report.ended = new Date().toISOString();
fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(`Evidence: ${output}`);
if (report.failure) console.error(report.failure);
