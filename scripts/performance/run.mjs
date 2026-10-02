import { requireWindows } from "../../shared/platform.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { summarizeRuns } from "./report.mjs";

requireWindows();

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const options = { runs: 5, clips: 24, startupOnly: false, out: os.tmpdir() };
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === "--help") {
    console.log(
      "npm run perf:measure -- [--runs 5] [--clips 24] [--startup-only] [--out directory]\nCreates a unique artifact directory; never reuses user profiles. Keep the window visible and avoid other benchmarks/tests.",
    );
    process.exit(0);
  }
  if (arg === "--startup-only") options.startupOnly = true;
  else if (["--runs", "--clips", "--out"].includes(arg)) {
    const value = process.argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = arg === "--out" ? path.resolve(value) : Number(value);
  } else throw new Error(`Unknown argument: ${arg}`);
}
if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 50)
  throw new Error("--runs must be 1..50");
if (!Number.isInteger(options.clips) || options.clips < 2 || options.clips > 120)
  throw new Error("--clips must be 2..120");
fs.mkdirSync(options.out, { recursive: true });
const artifacts = fs.mkdtempSync(path.join(options.out, "beru-performance-"));
console.log(`Artifacts: ${artifacts}`);
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = {
  schemaVersion: 1,
  appVersion: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version,
  createdAt: new Date().toISOString(),
  options,
  environment: {
    platform: process.platform,
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    availableMemoryBytes: os.freemem(),
    node: process.version,
  },
  runs: [],
};
try {
  report.checkout = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim(),
    sourceHashes: {},
  };
  const collect = (directory) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory() && !["__pycache__", "build", "dist"].includes(entry.name))
        collect(relative);
      else if (entry.isFile() && /\.(js|jsx|mjs|cjs|py|json)$/.test(entry.name))
        report.checkout.sourceHashes[relative.replaceAll("\\", "/")] = hash(
          path.join(root, relative),
        );
    }
  };
  for (const directory of ["src", "main", "shared", "python", "resources", "scripts/performance"])
    collect(directory);
  for (const file of [
    "package.json",
    "package-lock.json",
    "vite.config.js",
    "index.html",
    "pet-overlay.html",
  ]) {
    report.checkout.sourceHashes[file] = hash(path.join(root, file));
  }
  process.env.VITE_SUPABASE_URL = "";
  process.env.VITE_SUPABASE_ANON_KEY = "";
  const { build } = await import("vite");
  let chunks;
  await build({
    root,
    build: { outDir: path.join(artifacts, "build"), emptyOutDir: true },
    plugins: [
      {
        name: "beru-performance-harness",
        transform(code, id) {
          if (id.replaceAll("\\", "/").endsWith("/src/stores/useEditorStore.js"))
            return `${code}\nwindow.__beruPerfStore = useEditorStore;\n`;
        },
        generateBundle(_options, bundle) {
          chunks = Object.values(bundle)
            .filter((item) => item.type === "chunk")
            .map((item) => ({
              file: item.fileName,
              bytes: Buffer.byteLength(item.code),
              gzipBytes: gzipSync(item.code).length,
              sha256: createHash("sha256").update(item.code).digest("hex"),
              modules: Object.entries(item.modules)
                .filter(([, info]) => info.renderedLength > 0)
                .map(([id]) => path.relative(root, id).replaceAll("\\", "/")),
            }));
        },
      },
    ],
  });
  report.chunks = chunks.map((chunk) => ({
    ...chunk,
    bytes: fs.statSync(path.join(artifacts, "build", chunk.file)).size,
    gzipBytes: gzipSync(fs.readFileSync(path.join(artifacts, "build", chunk.file))).length,
    sha256: hash(path.join(artifacts, "build", chunk.file)),
  }));
  const binary = (name) => {
    const local = path.join(root, "bin", `${name}.exe`);
    if (fs.existsSync(local)) return local;
    return execFileSync("where", [name], {
      encoding: "utf8",
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
  };
  const paths = [];
  if (!options.startupOnly) {
    const directory = path.join(artifacts, "clips");
    fs.mkdirSync(directory);
    const source = path.join(directory, "clip-000.mp4");
    execFileSync(
      binary("ffmpeg"),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1920x1080:rate=30:duration=12",
        "-c:v",
        "libx264",
        "-threads",
        "4",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        source,
      ],
      { windowsHide: true, timeout: 120000 },
    );
    for (let index = 0; index < options.clips; index++) {
      const file = path.join(directory, `clip-${String(index).padStart(3, "0")}.mp4`);
      if (index > 0) fs.copyFileSync(source, file, fs.constants.COPYFILE_EXCL);
      paths.push(file);
    }
    report.fixture = {
      sha256: hash(source),
      bytes: fs.statSync(source).size,
      count: paths.length,
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 12,
      audio: false,
    };
  }
  const electron = require("electron");
  for (let index = 1; index <= options.runs; index++) {
    for (const kind of options.startupOnly ? ["cold", "warm"] : ["cold", "warm", "scenarios"]) {
      const label = `${index}-${kind}`;
      const configFile = path.join(artifacts, `${label}-config.json`);
      const resultFile = path.join(artifacts, `${label}.json`);
      const logFile = path.join(artifacts, `${label}.log`);
      const config = {
        label,
        kind,
        started: Date.now(),
        timeoutMs: 180000,
        profile: path.join(
          artifacts,
          `profile-${index}-${kind === "scenarios" ? "scenarios" : "startup"}`,
        ),
        build: path.join(artifacts, "build"),
        result: resultFile,
        output: path.join(artifacts, `exports-${index}`),
        paths,
        chunks: report.chunks,
      };
      json(configFile, config);
      const env = { ...process.env, BERU_PERF_CONFIG: configFile };
      delete env.ELECTRON_RUN_AS_NODE;
      const log = fs.openSync(logFile, "wx");
      let exitCode;
      try {
        exitCode = await new Promise((resolve, reject) => {
          const child = spawn(
            electron,
            [fileURLToPath(new URL("./electron.mjs", import.meta.url))],
            { cwd: root, env, stdio: ["ignore", log, log] },
          );
          const deadline = setTimeout(() => {
            try {
              execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore",
              });
            } catch (error) {
              console.error(`Could not terminate benchmark process ${child.pid}: ${error.message}`);
            }
            reject(new Error(`${label} timed out; see ${logFile}`));
          }, config.timeoutMs);
          child.once("error", (error) => {
            clearTimeout(deadline);
            reject(error);
          });
          child.once("exit", (code) => {
            clearTimeout(deadline);
            resolve(code);
          });
        });
      } finally {
        fs.closeSync(log);
      }
      const run = fs.existsSync(resultFile)
        ? JSON.parse(fs.readFileSync(resultFile, "utf8"))
        : { label, phases: [], failure: `No result; exit ${exitCode}; see ${logFile}` };
      if (exitCode !== 0 && !run.failure) run.failure = `Electron exited ${exitCode}`;
      report.runs.push(run);
      if (run.failure) throw new Error(`${label}: ${run.failure}`);
      for (const item of Object.values(run.binaries)) {
        if (fs.existsSync(item.path || item.command)) item.sha256 = hash(item.path || item.command);
      }
      console.log(
        `${label}: ${run.phases.map((phase) => `${phase.name}=${Math.round(phase.elapsedMs)}ms`).join(", ")}; closed panels: ${run.panelViolations.length}`,
      );
    }
  }
} catch (error) {
  report.failure = error.stack || String(error);
  process.exitCode = 1;
  console.error(report.failure);
} finally {
  if (report.checkout) {
    report.sourceChangedDuringRun = Object.entries(report.checkout.sourceHashes)
      .filter(
        ([file, digest]) =>
          !fs.existsSync(path.join(root, file)) || hash(path.join(root, file)) !== digest,
      )
      .map(([file]) => file);
    if (report.sourceChangedDuringRun.length) {
      report.failure ||= `Source changed during measurement: ${report.sourceChangedDuringRun.join(", ")}`;
      process.exitCode = 1;
      console.error(report.failure);
    }
  }
  report.summary = summarizeRuns(report.runs);
  json(path.join(artifacts, "report.json"), report);
  console.log(`Report: ${path.join(artifacts, "report.json")}`);
}
