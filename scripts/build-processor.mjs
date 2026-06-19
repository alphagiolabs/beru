// Builds bin/beru-processor(.exe) with PyInstaller so the Windows installer
// does not require users to install Python separately.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pythonDir = join(root, "python");
const binDir = join(root, "bin");
const specPath = join(pythonDir, "beru-processor.spec");
const exeName = process.platform === "win32" ? "beru-processor.exe" : "beru-processor";
const outputExe = join(binDir, exeName);
const profilesJson = join(root, "resources", "encode-profiles.json");

function resolveBuildPython() {
  if (process.env.BERU_PYTHON && existsSync(process.env.BERU_PYTHON)) {
    return { command: process.env.BERU_PYTHON, args: [] };
  }
  const candidates =
    process.platform === "win32"
      ? [
          { command: "py", args: ["-3"] },
          { command: "python", args: [] },
          { command: "python3", args: [] },
        ]
      : [
          { command: "python3", args: [] },
          { command: "python", args: [] },
        ];

  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate.command, [...candidate.args, "--version"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      if (probe.status === 0) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function ensurePyInstaller(python) {
  const check = spawnSync(python.command, [...python.args, "-m", "PyInstaller", "--version"], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (check.status === 0) return;

  console.log("[build:processor] Installing PyInstaller…");
  const install = spawnSync(
    python.command,
    [...python.args, "-m", "pip", "install", "pyinstaller>=6.0"],
    { stdio: "inherit" },
  );
  if (install.status !== 0) {
    throw new Error("Failed to install PyInstaller");
  }
}

function isUpToDate() {
  if (!existsSync(outputExe) || !existsSync(specPath)) return false;
  const exeMtime = statSync(outputExe).mtimeMs;
  const watchFiles = [
    join(pythonDir, "processor.py"),
    join(pythonDir, "encode_profiles.py"),
    join(pythonDir, "batch_errors.py"),
    join(pythonDir, "op_shared.py"),
    join(pythonDir, "delogo_chains.py"),
    join(pythonDir, "text_layout_helpers.py"),
    specPath,
    profilesJson,
  ];
  return watchFiles.every((file) => existsSync(file) && statSync(file).mtimeMs <= exeMtime);
}

if (!existsSync(profilesJson)) {
  console.error(`[build:processor] Missing ${profilesJson}`);
  process.exit(1);
}

if (process.env.BERU_FORCE_PROCESSOR_BUILD !== "1" && isUpToDate()) {
  console.log(`[build:processor] Up to date -> ${outputExe}`);
  process.exit(0);
}

const python = resolveBuildPython();
if (!python) {
  console.error(
    "[build:processor] Python 3 is required to build the bundled processor. " +
      "Install Python or set BERU_PYTHON.",
  );
  process.exit(1);
}

ensurePyInstaller(python);
mkdirSync(binDir, { recursive: true });
mkdirSync(join(root, "build", "pyinstaller"), { recursive: true });

console.log("[build:processor] Running PyInstaller…");
const build = spawnSync(
  python.command,
  [...python.args, "-m", "PyInstaller", specPath, "--noconfirm", "--clean"],
  { cwd: pythonDir, stdio: "inherit" },
);

if (build.status !== 0) {
  console.error("[build:processor] PyInstaller failed");
  process.exit(build.status || 1);
}

const builtExe = join(pythonDir, "dist", exeName);
if (!existsSync(builtExe)) {
  console.error(`[build:processor] Expected output not found: ${builtExe}`);
  process.exit(1);
}

if (builtExe !== outputExe) {
  copyFileSync(builtExe, outputExe);
}

console.log(`[build:processor] Built -> ${outputExe}`);
