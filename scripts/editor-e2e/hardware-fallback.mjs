import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO, RUN_ROOT, probe } from "./harness.mjs";
import { basicFixtures } from "./fixtures.mjs";
import { createReport } from "./report.mjs";

const SCENARIO = "hardware-fallback";
const processor = path.join(REPO, "bin", "beru-processor", "beru-processor.exe");
const realFfmpeg = path.join(REPO, "bin", "ffmpeg.exe");
const csc = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);
const dir = path.join(RUN_ROOT, SCENARIO);
const source = path.join(dir, "fuente.mp4");

function buildStandIn() {
  const exe = path.join(dir, "fake-ffmpeg.exe");
  const result = spawnSync(
    csc,
    [
      "/nologo",
      `/out:${exe}`,
      path.join(REPO, "scripts", "editor-e2e", "hardware-fallback", "Program.cs"),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`csc failed: ${result.stdout}${result.stderr}`);
  return exe;
}

function writeJobs(output) {
  const manifest = {
    type: "beru-job-manifest",
    version: 1,
    jobs: [
      {
        id: 0,
        input_path: source,
        output_path: output,
        source_width: 640,
        source_height: 360,
        video_duration: 8,
        frame_rate: 30,
        pix_fmt: "yuv420p",
        audio_codec: "aac",
        encode_profile: "balanced",
        operations: [{ mode: "blur", region: { x: 8, y: 8, w: 32, h: 32 } }],
      },
    ],
  };
  const file = path.join(dir, "jobs.json");
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return file;
}

function runProcessor(jobs, env) {
  const result = spawnSync(processor, [jobs], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const summary = (result.stdout ?? "")
    .split("\n")
    .find((line) => line.includes('"type": "summary"') || line.includes('"type":"summary"'));
  return {
    status: result.status,
    stderr: result.stderr ?? "",
    summary: summary ? JSON.parse(summary) : null,
  };
}

function main() {
  const report = createReport(SCENARIO);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(basicFixtures().a, source);
  if (!fs.existsSync(processor)) throw new Error(`Packaged processor not found: ${processor}`);
  const fake = buildStandIn();

  const cases = [
    {
      name: "equipo sin inyección",
      env: { BERU_FFMPEG: realFfmpeg },
      output: "control.mp4",
      expect: /Using hardware encoder: h264_qsv/,
      label: "elige el codificador de hardware disponible",
    },
    {
      name: "QSV falla en la prueba previa",
      env: { BERU_FFMPEG: fake, REAL_FFMPEG: realFfmpeg, FAKE_QSV_MODE: "preflight" },
      output: "preflight.mp4",
      expect: /Using hardware encoder: h264_mf/,
      label: "pasa al siguiente codificador de hardware",
    },
    {
      name: "QSV falla en la codificación real",
      env: { BERU_FFMPEG: fake, REAL_FFMPEG: realFfmpeg, FAKE_QSV_MODE: "encode" },
      output: "encode.mp4",
      expect: /hardware path failed, retrying with libx264/,
      label: "reintenta el trabajo en software",
    },
  ];

  for (const test of cases) {
    const output = path.join(dir, test.output);
    fs.rmSync(output, { force: true });
    const jobs = writeJobs(output);
    const run = runProcessor(jobs, test.env);
    report.check(
      `${test.name}: el trabajo termina`,
      run.summary?.succeeded === 1 && run.summary?.failed === 0,
      run.summary ? JSON.stringify(run.summary) : run.stderr.slice(-200),
    );
    report.check(
      `${test.name}: ${test.label}`,
      test.expect.test(run.stderr),
      (run.stderr.match(/Using hardware encoder: \S+|retrying with libx264/g) ?? []).join(" | "),
    );
    if (fs.existsSync(output)) {
      const info = probe(output);
      report.check(
        `${test.name}: el MP4 dura 8 s`,
        Math.abs(info.durationS - 8) < 0.2,
        `${info.durationS.toFixed(2)} s`,
      );
    }
  }
  const summary = report.finish();
  if (summary.failed > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
