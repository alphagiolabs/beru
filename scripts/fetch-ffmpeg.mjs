import { requireWindows } from "../shared/platform.js";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

requireWindows();

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const manifest = JSON.parse(await readFile(join(root, "resources/media-binaries.json"), "utf8"));

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function filesMatch(directory) {
  for (const file of manifest.files) {
    try {
      if ((await sha256(join(directory, file.target))) !== file.sha256) return false;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}

function verifyVersion(binary) {
  const result = spawnSync(binary, ["-version"], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const version = result.stdout?.match(/^ff(?:mpeg|probe) version (\d+\.\d+\.\d+)(?:-|\s)/)?.[1];
  if (result.status !== 0 || version !== manifest.version) {
    throw new Error(`[ffmpeg] Unexpected binary version: ${binary}`);
  }
}

async function downloadArchive(destination) {
  const response = await fetch(manifest.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`[ffmpeg] Download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function extractArchive(archive, destination) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:BERU_FFMPEG_ZIP, $env:BERU_FFMPEG_EXTRACT)",
    ],
    {
      env: { ...process.env, BERU_FFMPEG_ZIP: archive, BERU_FFMPEG_EXTRACT: destination },
      encoding: "utf8",
      timeout: 60000,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`[ffmpeg] Extraction failed: ${result.stderr}`);
}

export async function ensureMediaBinaries({ destination = join(root, "bin"), archivePath } = {}) {
  if (await filesMatch(destination)) {
    for (const name of ["ffmpeg.exe", "ffprobe.exe"]) verifyVersion(join(destination, name));
    return { updated: false, version: manifest.version };
  }

  const staging = await mkdtemp(join(tmpdir(), "beru-ffmpeg-"));
  try {
    const archive = archivePath ? resolve(archivePath) : join(staging, "ffmpeg.zip");
    if (!archivePath) await downloadArchive(archive);
    if ((await sha256(archive)) !== manifest.archiveSha256) {
      throw new Error("[ffmpeg] Archive SHA-256 mismatch; binaries were not installed");
    }
    const extracted = join(staging, "extracted");
    extractArchive(archive, extracted);
    const source = join(extracted, manifest.directory);
    for (const file of manifest.files) {
      if ((await sha256(join(source, file.source))) !== file.sha256) {
        throw new Error(`[ffmpeg] SHA-256 mismatch: ${file.source}`);
      }
    }
    for (const name of ["ffmpeg.exe", "ffprobe.exe"]) verifyVersion(join(source, "bin", name));
    await mkdir(destination, { recursive: true });
    for (const file of manifest.files) {
      await copyFile(join(source, file.source), join(destination, file.target));
    }
    return { updated: true, version: manifest.version };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const result = await ensureMediaBinaries({ archivePath: process.env.BERU_FFMPEG_ARCHIVE });
    console.log(
      `[ffmpeg] FFmpeg/ffprobe ${result.version}: ${result.updated ? "installed" : "verified"}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
