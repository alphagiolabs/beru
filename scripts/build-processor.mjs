import { requireWindows } from "../shared/platform.js";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isProcessorCurrent,
  processorBuildFingerprint,
  writeProcessorReceipt,
} from "./processor-build-state.mjs";

requireWindows();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pythonDir = join(root, "python");
const binDir = join(root, "bin");
const specPath = join(pythonDir, "beru-processor.spec");
const exeName = "beru-processor.exe";
const outputExe = join(binDir, exeName);
const profilesJson = join(root, "resources", "encode-profiles.json");
const pythonVersionFile = join(root, ".python-version");
const pythonVersion = readFileSync(pythonVersionFile, "utf8").trim();
const requirementsPath = join(pythonDir, "requirements-build.txt");
const environmentDir = join(root, ".venv-processor");
const environmentPython = join(environmentDir, "Scripts", "python.exe");
const receiptPath = join(pythonDir, "build", "processor-build.json");
const expectedPackages = Object.fromEntries(
  [...readFileSync(requirementsPath, "utf8").matchAll(/^([\w-]+) @ (\S+)/gm)].map(
    ([, name, url]) => [name, new URL(url).pathname.split("/").at(-1).split("-")[1]],
  ),
);
const buildEnv = { ...process.env, PYTHONNOUSERSITE: "1" };
delete buildEnv.PYTHONPATH;
delete buildEnv.PYTHONHOME;

function probePython(command, args = [], packages = false) {
  const code = [
    "import json, sys, struct, platform, importlib.metadata as m",
    `include_packages = ${packages ? "True" : "False"}`,
    "packages = {d.metadata['Name'].lower().replace('_', '-'): d.version for d in m.distributions()} if include_packages else {}",
    "print(json.dumps({'python': platform.python_version(), 'bits': struct.calcsize('P') * 8, 'machine': platform.machine(), 'base': sys.base_prefix, 'packages': packages}))",
  ].join("\n");
  const result = spawnSync(command, [...args, "-I", "-c", code], {
    encoding: "utf8",
    env: buildEnv,
    windowsHide: true,
    timeout: 15000,
  });
  try {
    return result.status === 0 ? JSON.parse(result.stdout) : null;
  } catch {
    return null;
  }
}

function matchesPython(info) {
  return info?.python === pythonVersion && info.bits === 64 && info.machine === "AMD64";
}

function runPython(python, args, message) {
  const result = spawnSync(python.command, [...python.args, ...args], {
    cwd: pythonDir,
    env: buildEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${message} (exit ${result.status})`);
}

function resolveBuildPython() {
  if (process.env.BERU_PYTHON) {
    const candidate = { command: process.env.BERU_PYTHON, args: [] };
    if (!matchesPython(probePython(candidate.command))) {
      throw new Error(`BERU_PYTHON must point to Python ${pythonVersion} x64`);
    }
    return candidate;
  }
  const candidates = [
    { command: join(root, ".runtime", `python-${pythonVersion}`, "python.exe"), args: [] },
    { command: "py", args: [`-${pythonVersion.split(".").slice(0, 2).join(".")}`] },
    { command: "python", args: [] },
    { command: "python3", args: [] },
  ];

  for (const candidate of candidates) {
    if (matchesPython(probePython(candidate.command, candidate.args))) return candidate;
  }
  return null;
}

function prepareEnvironment(basePython) {
  const existing = probePython(environmentPython);
  if (existing && !matchesPython(existing)) {
    throw new Error(`Recreate ${environmentDir} with Python ${pythonVersion} x64`);
  }
  if (!existing) {
    runPython(
      basePython,
      ["-I", "-m", "venv", environmentDir],
      "Failed to create build environment",
    );
  }
  const python = { command: environmentPython, args: [] };
  let toolchain = probePython(environmentPython, [], true);
  const matchesPackages = (info) =>
    matchesPython(info) &&
    Object.entries(expectedPackages).every(([name, version]) => info.packages[name] === version);
  const unexpected = Object.keys(toolchain?.packages ?? {}).filter(
    (name) => name !== "pip" && !Object.hasOwn(expectedPackages, name),
  );
  if (unexpected.length) {
    throw new Error(`Recreate ${environmentDir}: unexpected packages ${unexpected.join(", ")}`);
  }
  if (!matchesPackages(toolchain)) {
    runPython(
      python,
      [
        "-I",
        "-m",
        "pip",
        "--isolated",
        "install",
        "--require-hashes",
        "--only-binary=:all:",
        "--index-url=https://pypi.org/simple",
        "--timeout=30",
        "--retries=2",
        "--disable-pip-version-check",
        "-r",
        requirementsPath,
      ],
      "Failed to install locked processor dependencies",
    );
    toolchain = probePython(environmentPython, [], true);
  }
  if (!matchesPackages(toolchain)) throw new Error("Processor toolchain does not match its lock");
  runPython(python, ["-I", "-m", "pip", "check"], "Invalid processor dependencies");
  runPython(
    python,
    [
      "-I",
      "-c",
      `import sys; sys.path.insert(0, ${JSON.stringify(pythonDir)}); import numpy, temporal_motion, temporal_pipeline`,
    ],
    "Processor runtime dependencies could not load",
  );
  return { python, toolchain };
}

const watchFiles = [
  join(pythonDir, "processor.py"),
  join(pythonDir, "encode_profiles.py"),
  join(pythonDir, "batch_errors.py"),
  join(pythonDir, "batch_context.py"),
  join(pythonDir, "capacity.py"),
  join(pythonDir, "encoders.py"),
  join(pythonDir, "encode_args.py"),
  join(pythonDir, "ffmpeg_runner.py"),
  join(pythonDir, "filters.py"),
  join(pythonDir, "fonts.py"),
  join(pythonDir, "job_classify.py"),
  join(pythonDir, "media_paths.py"),
  join(pythonDir, "media_probe.py"),
  join(pythonDir, "op_shared.py"),
  join(pythonDir, "preview.py"),
  join(pythonDir, "temporal_motion.py"),
  join(pythonDir, "temporal_pipeline.py"),
  join(pythonDir, "spatial_inpaint.py"),
  join(pythonDir, "requirements.txt"),
  join(pythonDir, "delogo_chains.py"),
  join(pythonDir, "text_layout_helpers.py"),
  join(pythonDir, "color_validation.py"),
  specPath,
  profilesJson,
  requirementsPath,
  pythonVersionFile,
  fileURLToPath(import.meta.url),
  join(__dirname, "processor-build-state.mjs"),
];

if (!existsSync(profilesJson)) {
  console.error(`[build:processor] Missing ${profilesJson}`);
  process.exit(1);
}

const basePython = resolveBuildPython();
if (!basePython) {
  console.error(
    `[build:processor] Python ${pythonVersion} x64 is required to build the bundled processor. ` +
      "Install Python or set BERU_PYTHON.",
  );
  process.exit(1);
}

const { python, toolchain } = prepareEnvironment(basePython);
const fingerprint = processorBuildFingerprint(watchFiles, toolchain);
if (
  process.env.BERU_FORCE_PROCESSOR_BUILD !== "1" &&
  isProcessorCurrent(outputExe, receiptPath, fingerprint)
) {
  console.log(`[build:processor] Up to date -> ${outputExe}`);
  process.exit(0);
}
mkdirSync(binDir, { recursive: true });
mkdirSync(dirname(receiptPath), { recursive: true });

console.log("[build:processor] Running PyInstaller…");
runPython(
  python,
  ["-I", "-m", "PyInstaller", specPath, "--noconfirm", "--clean"],
  "PyInstaller failed",
);

const builtExe = join(pythonDir, "dist", exeName);
if (!existsSync(builtExe)) {
  console.error(`[build:processor] Expected output not found: ${builtExe}`);
  process.exit(1);
}

runPython(
  python,
  [
    "-I",
    "-c",
    [
      "import sys; from PyInstaller.archive.readers import CArchiveReader",
      "archive = CArchiveReader(sys.argv[1]); modules = archive.open_embedded_archive('PYZ.pyz').toc",
      "required = {'numpy', 'temporal_motion', 'temporal_pipeline'}; missing = required.difference(modules)",
      "assert not missing, f'Missing bundled runtime modules: {sorted(missing)}'",
      "assert any('_multiarray_umath' in name for name in archive.toc), 'Missing NumPy native extension'",
      `assert 'python${pythonVersion.split(".").slice(0, 2).join("")}.dll' in archive.toc, 'Unexpected bundled Python runtime'`,
      "print('[build:processor] Bundled Python, NumPy and temporal modules verified')",
    ].join("\n"),
    builtExe,
  ],
  "Packaged processor is incomplete",
);

if (builtExe !== outputExe) {
  copyFileSync(builtExe, outputExe);
}
writeProcessorReceipt(outputExe, receiptPath, fingerprint, toolchain);

console.log(`[build:processor] Built -> ${outputExe}`);
