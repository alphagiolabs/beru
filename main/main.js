import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from "electron";
import { spawn, spawnSync, exec } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";
import { randomBytes } from "crypto";
import * as updater from "./updater.js";
import { probeVideoFile } from "./videoProbe.js";
import { createPathSecurity } from "./pathSecurity.js";
import {
  pickHwEncoderFromEncodersText,
  recommendBatchWorkers,
} from "./workerPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const pathSecurity = createPathSecurity(app);

let mainWindow = null;
let pythonProcess = null;
let currentTmpFile = null;
let isProcessing = false;
let lastProcessingError = null;

function getPythonPath() {
  if (isDev) return path.join(__dirname, "..", "python", "processor.py");
  return path.join(process.resourcesPath, "python", "processor.py");
}

function getFfprobePath() {
  if (fs.existsSync(path.join(__dirname, "..", "src-tauri", "bin", "ffprobe.exe"))) {
    return path.join(__dirname, "..", "src-tauri", "bin", "ffprobe.exe");
  }
  const bundled = path.join(process.resourcesPath, "bin", "ffprobe.exe");
  if (!isDev && fs.existsSync(bundled)) return bundled;
  return null;
}

function getFfmpegPath() {
  if (fs.existsSync(path.join(__dirname, "..", "src-tauri", "bin", "ffmpeg.exe"))) {
    return path.join(__dirname, "..", "src-tauri", "bin", "ffmpeg.exe");
  }
  const bundled = path.join(process.resourcesPath, "bin", "ffmpeg.exe");
  if (!isDev && fs.existsSync(bundled)) return bundled;
  return null;
}

const videoInfoCache = new Map();
const VIDEO_INFO_CACHE_MAX = 500;

function trimVideoInfoCache() {
  if (videoInfoCache.size <= VIDEO_INFO_CACHE_MAX) return;
  const keys = videoInfoCache.keys();
  const excess = videoInfoCache.size - VIDEO_INFO_CACHE_MAX;
  for (let i = 0; i < excess; i++) {
    videoInfoCache.delete(keys.next().value);
  }
}

function getVideoMtimeMs(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch { return -1; }
}

/** Fast metadata read for batch import (ffprobe only, cached by path+mtime). */
async function probeVideoFast(filePath) {
  const mtime = getVideoMtimeMs(filePath);
  if (mtime >= 0) {
    const hit = videoInfoCache.get(filePath);
    if (hit && hit.mtime === mtime) return hit.info;
  }
  const info = await probeVideoFile(filePath, {
    ffprobePath: getFfprobePath(),
    ffmpegPath: getFfmpegPath(),
    timeoutMs: 2500,
    allowFfmpegFallback: false,
  });
  if (mtime >= 0) { videoInfoCache.set(filePath, { mtime, info }); trimVideoInfoCache(); }
  return info;
}

function probeVideo(filePath) {
  return probeVideoFile(filePath, {
    ffprobePath: getFfprobePath(),
    ffmpegPath: getFfmpegPath(),
    timeoutMs: 5000,
    allowFfmpegFallback: true,
  });
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const launch = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  };
  const runners = Array.from({ length: Math.min(limit, items.length) }, launch);
  await Promise.all(runners);
  return results;
}

const DEV_URL = "http://localhost:5173";
const BUILD_INDEX = path.join(__dirname, "..", "build", "index.html");

function loadProductionBuild() {
  if (!fs.existsSync(BUILD_INDEX)) {
    console.error("[beru] Missing build/index.html — run: npm run build");
    return false;
  }
  mainWindow.loadFile(BUILD_INDEX);
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Beru",
    icon: path.join(__dirname, "..", "brand", "icon.ico"),
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow.setMenu(null);

  let devFallbackUsed = false;
  if (isDev) {
    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || devFallbackUsed) return;
      if (!validatedURL?.startsWith(DEV_URL)) return;
      devFallbackUsed = true;
      console.warn(
        `[beru] Dev server unavailable (${errorCode} ${errorDescription}). ` +
        "Loading build/ — start Vite with: npm run dev",
      );
      loadProductionBuild();
    });
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    loadProductionBuild();
  }

  // Initialize the auto-updater (no-op in dev). Safe to call after window is ready.
  updater.init(mainWindow);
}

// ── IPC Handlers ──────────────────────────────────────────────────────────

ipcMain.handle("dialog:openVideos", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Seleccionar videos",
    filters: [{ name: "Videos", extensions: ["mp4", "mov", "avi", "mkv", "webm"] }],
    properties: ["openFile", "multiSelections"],
  });
  if (canceled || filePaths.length === 0) return [];
  pathSecurity.registerAllowedPaths(filePaths);
  return filePaths;
});

ipcMain.handle("dialog:openExcel", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Seleccionar archivo Excel",
    filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return null;
  pathSecurity.registerAllowedPath(filePaths[0]);
  return filePaths[0];
});

ipcMain.handle("dialog:selectOutputDir", async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Seleccionar carpeta de salida",
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || !filePaths || filePaths.length === 0) return null;
    return filePaths[0];
  } catch (err) {
    console.error("[beru] Error opening output directory dialog:", err);
    return null;
  }
});

ipcMain.handle("fs:getVideoInfo", async (_event, filePath) => {
  const check = pathSecurity.validateReadableFile(filePath, "video");
  if (!check.ok) return { exists: false, width: 0, height: 0, duration: 0, error: check.error };
  try {
    return await probeVideo(check.resolvedPath);
  } catch {
    return { exists: true, width: 0, height: 0, duration: 0 };
  }
});

ipcMain.handle("fs:getVideoInfoBatch", async (_event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
  const cpus = os.cpus()?.length || 4;
  const limit = Math.max(2, Math.min(16, filePaths.length, cpus * 2));
  const fastResults = await runWithConcurrency(filePaths, limit, probeVideoFast);
  return await Promise.all(fastResults.map(async (info, i) => {
    if (info.width > 0 && info.height > 0) return info;
    const check = pathSecurity.validateReadableFile(filePaths[i], "video");
    if (!check.ok) return info;
    try {
      const full = await probeVideo(check.resolvedPath);
      if (full.width > 0 && full.height > 0) return full;
    } catch (e) {
      console.error("[beru] Full video probe failed:", filePaths[i], e.message);
    }
    return info;
  }));
});

const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v|mpg|mpeg)$/i;
const MAX_FOLDER_DEPTH = 8;
const MAX_FILES_PER_DROP = 500;

const collectVideoFilesSync = (root, depth, out) => {
  if (depth > MAX_FOLDER_DEPTH || out.length >= MAX_FILES_PER_DROP) return;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (out.length >= MAX_FILES_PER_DROP) return;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      // skip hidden / system / node_modules
      if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "System Volume Information") continue;
      collectVideoFilesSync(full, depth + 1, out);
    } else if (ent.isFile() && VIDEO_EXT.test(ent.name)) {
      out.push(full);
    }
  }
};

ipcMain.handle("fs:resolveDroppedPaths", async (_event, inputPaths) => {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    return { videoPaths: [], ignoredCount: 0 };
  }
  const videoPaths = [];
  let ignoredCount = 0;
  for (const p of inputPaths) {
    if (!p || typeof p !== "string") { ignoredCount++; continue; }
    let stat;
    try { stat = fs.statSync(p); } catch { ignoredCount++; continue; }
    if (stat.isDirectory()) {
      const before = videoPaths.length;
      collectVideoFilesSync(p, 0, videoPaths);
      // if folder had no videos, count it as 1 ignored item
      if (videoPaths.length === before) ignoredCount++;
    } else if (stat.isFile()) {
      if (VIDEO_EXT.test(p)) videoPaths.push(p);
      else ignoredCount++;
    } else {
      ignoredCount++;
    }
  }
  pathSecurity.registerAllowedPaths(videoPaths);
  return { videoPaths, ignoredCount };
});

// ── Thumbnail extraction (single frame, base64 JPEG) ──────────────────────

const extractThumbnail = (filePath, width = 80) => new Promise((resolve) => {
  const ffmpeg = getFfmpegPath();
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(filePath)) return resolve(null);
  const chunks = [];
  let settled = false;
  let killTimer = null;
  const proc = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error",
    "-ss", "1",
    "-i", filePath,
    "-an", "-sn", "-dn",
    "-vframes", "1",
    "-vf", `scale=${width}:-2`,
    "-q:v", "10",
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "-",
  ]);
  const finish = (data) => {
    if (settled) return;
    settled = true;
    if (killTimer) clearTimeout(killTimer);
    try { proc.kill(); } catch {}
    resolve(data);
  };
  proc.stdout.on("data", (d) => chunks.push(d));
  proc.stderr.on("data", () => {}); // ignore
  proc.on("error", () => finish(null));
  proc.on("close", (code) => {
    if (code !== 0) return finish(null);
    const buf = Buffer.concat(chunks);
    if (buf.length < 64) return finish(null);
    const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
    finish({ dataUrl, size: buf.length });
  });
  killTimer = setTimeout(() => finish(null), 5000);
});

ipcMain.handle("video:thumbnail", async (_event, filePath) => {
  const check = pathSecurity.validateReadableFile(filePath, "video");
  if (!check.ok) return null;
  return await extractThumbnail(check.resolvedPath, 80);
});

ipcMain.handle("video:thumbnailBatch", async (_event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
  const cpus = os.cpus()?.length || 4;
  const limit = Math.max(2, Math.min(8, filePaths.length, cpus));
  return await runWithConcurrency(filePaths, limit, (p) => extractThumbnail(p, 80));
});

ipcMain.handle("fs:readExcel", async (_event, filePath) => {
  const check = pathSecurity.validateReadableFile(filePath, "excel");
  if (!check.ok) return { error: check.error };
  try {
    const buffer = await fs.promises.readFile(check.resolvedPath);
    return { data: buffer.toString("base64"), name: path.basename(check.resolvedPath) };
  } catch (e) {
    return { error: e.message };
  }
});

function sendToRenderer(channel, data) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  } catch (e) {
    console.error("[beru] IPC send failed:", channel, e.message);
  }
}

function resolvePythonSpawn() {
  if (process.env.BERU_PYTHON && fs.existsSync(process.env.BERU_PYTHON)) {
    return { command: process.env.BERU_PYTHON, args: [] };
  }
  if (process.platform === "win32") {
    return { command: "py", args: ["-3"] };
  }
  return { command: "python3", args: [] };
}

function dispatchProcessorLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    if (msg.type === "progress") sendToRenderer("process:progress", msg);
    else if (msg.type === "job_progress") sendToRenderer("process:jobProgress", msg);
    else if (msg.type === "complete") sendToRenderer("process:complete", msg);
    else if (msg.type === "error") {
      const errText = msg.error || msg.message || "Unknown error";
      const idx = msg.index;
      if (Number.isInteger(idx) && idx >= 0) {
        sendToRenderer("process:jobError", msg);
      } else {
        lastProcessingError = errText;
        sendToRenderer("process:error", errText);
      }
    } else if (msg.type === "summary") sendToRenderer("process:summary", msg);
    else sendToRenderer("process:log", trimmed);
  } catch {
    sendToRenderer("process:log", trimmed);
  }
}

ipcMain.handle("process:start", async (_event, jobs) => {
  if (isProcessing) {
    return { success: false, error: "Ya hay un proceso en ejecución" };
  }

  try {
    const scriptPath = getPythonPath();
    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: "processor.py not found" };
    }

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return { success: false, error: "No hay videos para procesar" };
    }

    for (const job of jobs) {
      if (job?.input_path) pathSecurity.registerAllowedPath(job.input_path);
    }

    isProcessing = true;
    lastProcessingError = null;

    const uid = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    currentTmpFile = path.join(app.getPath("temp"), `beru-jobs-${uid}.json`);
    const cancelFile = currentTmpFile.replace(".json", ".cancel");
    try { fs.unlinkSync(cancelFile); } catch {}
    const enrichedJobs = await Promise.all(jobs.map(async (job) => {
      const sw = Number(job.source_width || job.width || 0);
      const sh = Number(job.source_height || job.height || 0);
      if (sw > 0 && sh > 0) {
        return {
          ...job,
          width: sw,
          height: sh,
          source_width: sw,
          source_height: sh,
        };
      }
      if (!job?.input_path) return job;
      try {
        const info = await probeVideo(job.input_path);
        if (info.width > 0 && info.height > 0) {
        return {
          ...job,
          width: info.width,
          height: info.height,
          source_width: info.width,
          source_height: info.height,
          video_duration: info.duration || job.video_duration || 0,
          video_codec: info.videoCodec || job.video_codec || "",
          pix_fmt: info.pixFmt || job.pix_fmt || "yuv420p",
          frame_rate: info.frameRate || job.frame_rate || 0,
          audio_codec: info.audioCodec || job.audio_codec || "",
          audio_channels: info.audioChannels || job.audio_channels || 0,
        };
        }
      } catch (e) {
        console.error("[beru] Job probe failed:", job.input_path, e.message);
      }
      return job;
    }));

    await fs.promises.writeFile(currentTmpFile, JSON.stringify(enrichedJobs));

    const firstProfile = enrichedJobs[0]?.encode_profile || "balanced";
    const settings = readSettings();
    const batchWorkersMode = settings.batchWorkersMode === "conservative"
      ? "conservative"
      : "balanced";
    let workerCount = "0";
    if (Number(settings.batchWorkers) > 0) {
      workerCount = String(Math.min(16, Math.floor(Number(settings.batchWorkers))));
    }

    const py = resolvePythonSpawn();
    const ffmpegPath = getFfmpegPath();
    const ffprobePath = getFfprobePath();
    const childEnv = {
      ...process.env,
      BERU_WORKERS: workerCount,
      BERU_WORKERS_MODE: batchWorkersMode,
      BERU_RETRY_FAILED: settings.batchRetryFailed === false ? "0" : "1",
      BERU_ENCODE_PROFILE: firstProfile,
    };
    if (ffmpegPath) childEnv.BERU_FFMPEG = ffmpegPath;
    if (ffprobePath) childEnv.BERU_FFPROBE = ffprobePath;
    pythonProcess = spawn(py.command, [...py.args, scriptPath, currentTmpFile], {
      windowsHide: true,
      env: childEnv,
    });

    let stdoutBuf = "";

    const finishProcessing = (result) => {
      pythonProcess = null;
      isProcessing = false;
      try { currentTmpFile && fs.unlinkSync(currentTmpFile); } catch {}
      currentTmpFile = null;
      return result;
    };

    pythonProcess.stdout.on("data", (data) => {
      stdoutBuf += data.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() || "";
      for (const line of lines) dispatchProcessorLine(line);
    });

    pythonProcess.stderr.on("data", (data) => {
      const text = data.toString().trim();
      if (text) console.error("[beru][processor]", text);
    });

    return new Promise((resolve) => {
      pythonProcess.on("close", (code) => {
        if (stdoutBuf.trim()) dispatchProcessorLine(stdoutBuf);
        sendToRenderer("process:finished", { code });
        const failed = code !== 0;
        resolve(finishProcessing({
          success: !failed,
          code,
          error: failed
            ? (lastProcessingError || `Process exited with code ${code}`)
            : undefined,
        }));
      });

      pythonProcess.on("error", (err) => {
        lastProcessingError = err.message;
        sendToRenderer("process:error", err.message);
        resolve(finishProcessing({ success: false, code: 1, error: err.message }));
      });
    });
  } catch (err) {
    isProcessing = false;
    pythonProcess = null;
    console.error("[beru] process:start failed:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("shell:openPath", async (_event, filePath) => {
  const check = pathSecurity.validateShellPath(filePath);
  if (!check.ok) return { success: false, error: check.error };
  filePath = check.resolvedPath;
  if (!filePath) return { success: false, error: "No path provided" };
  if (!fs.existsSync(filePath)) {
    return { success: false, error: "Archivo no existe" };
  }
  const result = await shell.openPath(filePath);
  if (result) return { success: false, error: result };
  return { success: true };
});

ipcMain.handle("process:cancel", async () => {
  if (currentTmpFile) {
    const cancelFile = currentTmpFile.replace(".json", ".cancel");
    try { fs.writeFileSync(cancelFile, "1"); } catch {}
  }

  if (pythonProcess && pythonProcess.pid) {
    if (process.platform === "win32") {
      exec(`taskkill /F /T /PID ${pythonProcess.pid}`, (err) => {
        if (err) console.error("[beru] taskkill error:", err.message);
      });
    } else {
      pythonProcess.kill("SIGTERM");
    }
    pythonProcess = null;
  }
  return { success: true };
});

// ── Project save / load ────────────────────────────────────────────────────

ipcMain.handle("project:save", async (_event, payload) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Guardar proyecto Beru",
    defaultPath: "proyecto.beru.json",
    filters: [{ name: "Proyecto Beru", extensions: ["beru.json", "json"] }],
  });
  if (canceled || !filePath) return { success: false, canceled: true };
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    return { success: true, filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Image picker / reader ──────────────────────────────────────────────────

const IMAGE_MIMES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

ipcMain.handle("image:read", async (_event, imagePath) => {
  const check = pathSecurity.validateReadableFile(imagePath, "image");
  if (!check.ok) return { success: false, error: check.error };
  const ext = path.extname(check.resolvedPath).toLowerCase();
  const mime = IMAGE_MIMES[ext];
  if (!mime) {
    return { success: false, error: `Formato no soportado: ${ext}` };
  }
  try {
    const buf = fs.readFileSync(check.resolvedPath);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    return { success: true, dataUrl, size: buf.length, mime };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("image:pick", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Elegir imagen",
    properties: ["openFile"],
    filters: [
      { name: "Imágenes", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
    ],
  });
  if (canceled || !filePaths || filePaths.length === 0) return { success: false, canceled: true };
  pathSecurity.registerAllowedPath(filePaths[0]);
  return { success: true, path: filePaths[0] };
});

// ── Presets ────────────────────────────────────────────────────────────────

const readPresetsFromDir = (dir, source) => {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".beru.json") && !name.toLowerCase().endsWith(".json")) continue;
    const full = path.join(dir, name);
    try {
      const raw = fs.readFileSync(full, "utf8");
      const data = JSON.parse(raw);
      if (data && (data.type === "beru-preset" || data.type === "beru-project")) {
        out.push({
          name: data.name || name.replace(/\.beru\.json$|\.json$/i, ""),
          description: data.description || "",
          filename: name,
          source,
          data,
        });
      }
    } catch (e) {
      console.error(`[beru] Failed to read preset ${full}:`, e.message);
    }
  }
  return out;
};

ipcMain.handle("presets:list", async () => {
  try {
    // Bundled: <appPath>/resources/presets in dev, <resourcesPath>/presets in prod
    const isPackaged = app.isPackaged;
    const bundledDir = isPackaged
      ? path.join(process.resourcesPath, "presets")
      : path.join(app.getAppPath(), "resources", "presets");

    // User folder
    const userDir = path.join(app.getPath("userData"), "presets");
    try { fs.mkdirSync(userDir, { recursive: true }); } catch {}

    const bundled = readPresetsFromDir(bundledDir, "bundled");
    const user = readPresetsFromDir(userDir, "user");

    return { success: true, presets: [...bundled, ...user], userDir };
  } catch (e) {
    return { success: false, error: e.message, presets: [] };
  }
});

ipcMain.handle("presets:save", async (_event, name, jsonStr) => {
  try {
    if (typeof name !== "string" || !name.trim()) {
      return { success: false, error: "Nombre inválido" };
    }
    if (typeof jsonStr !== "string" || !jsonStr.trim()) {
      return { success: false, error: "Datos inválidos" };
    }
    // Validate JSON before touching disk
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch (e) { return { success: false, error: "JSON inválido: " + e.message }; }
    if (!parsed || parsed.type !== "beru-preset") {
      return { success: false, error: "Falta type: 'beru-preset'" };
    }
    // Sanitize: strip path separators and forbidden chars
    const safeBase = name.trim()
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
      .replace(/^\.+/, "_")
      .slice(0, 80);
    if (!safeBase) return { success: false, error: "Nombre inválido" };
    const fileName = safeBase.toLowerCase().endsWith(".beru.json") ? safeBase : `${safeBase}.beru.json`;
    const userDir = path.join(app.getPath("userData"), "presets");
    try { fs.mkdirSync(userDir, { recursive: true }); } catch {}
    const filePath = path.join(userDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
    return { success: true, fileName, filePath, userDir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Settings (theme, future preferences) ──────────────────────────────────

const SETTINGS_DEFAULTS = {
  theme: "dark",
  language: "es",
  encodeProfile: "balanced",
  batchWorkers: 0,
  batchWorkersMode: "balanced",
  batchRetryFailed: true,
};

let cachedHwEncoder = null;

async function detectHwEncoderCached() {
  if (cachedHwEncoder !== null) return cachedHwEncoder || null;
  const ffmpeg = getFfmpegPath();
  try {
    const r = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    const text = `${r.stdout || ""}${r.stderr || ""}`;
    cachedHwEncoder = pickHwEncoderFromEncodersText(text) || "";
  } catch {
    cachedHwEncoder = "";
  }
  return cachedHwEncoder || null;
}

ipcMain.handle("system:getBatchCapacity", async (_event, opts = {}) => {
  const settings = readSettings();
  const mode = settings.batchWorkersMode === "conservative" ? "conservative" : "balanced";
  const jobCount = Math.max(1, Number(opts.jobCount) || 1);
  const maxSourcePixels = Math.max(0, Number(opts.maxSourcePixels) || 0);
  const explicitWorkers = Number(settings.batchWorkers) > 0
    ? Math.floor(Number(settings.batchWorkers))
    : 0;
  const hwEncoder = await detectHwEncoderCached();
  const rec = recommendBatchWorkers({
    hwEncoder,
    jobCount,
    maxSourcePixels,
    mode,
    explicitWorkers,
  });
  return {
    ...rec,
    explicitWorkers,
    maxWorkersCap: 16,
  };
});

const readSettings = () => {
  try {
    const file = path.join(app.getPath("userData"), "settings.json");
    if (!fs.existsSync(file)) return { ...SETTINGS_DEFAULTS };
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return { ...SETTINGS_DEFAULTS, ...parsed };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
};

const writeSettings = (obj) => {
  const file = path.join(app.getPath("userData"), "settings.json");
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
};

ipcMain.handle("settings:load", async () => {
  return readSettings();
});

ipcMain.handle("settings:save", async (_event, partial) => {
  try {
    if (!partial || typeof partial !== "object") return { success: false, error: "Payload inválido" };
    const current = readSettings();
    const next = { ...current, ...partial };
    writeSettings(next);
    return { success: true, settings: next };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Recent projects (last 8 .beru.json paths) ────────────────────────────

const RECENT_MAX = 8;
const readRecent = () => {
  try {
    const file = path.join(app.getPath("userData"), "recent.json");
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r.path === "string" && typeof r.name === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
};
const writeRecent = (arr) => {
  const file = path.join(app.getPath("userData"), "recent.json");
  fs.writeFileSync(file, JSON.stringify(arr, null, 2), "utf8");
};

ipcMain.handle("recent:list", async () => {
  const list = readRecent();
  // Mark which still exist on disk (cheap statSync)
  return list.map((r) => {
    let exists = true;
    try { exists = fs.existsSync(r.path); } catch { exists = false; }
    return { ...r, exists };
  });
});

ipcMain.handle("recent:add", async (_event, entry) => {
  try {
    if (!entry || typeof entry.path !== "string" || !entry.path.trim()) {
      return { success: false, error: "Path inválido" };
    }
    const norm = path.normalize(entry.path);
    const list = readRecent().filter((r) => path.normalize(r.path) !== norm);
    const next = [
      {
        path: norm,
        name: typeof entry.name === "string" && entry.name ? entry.name : path.basename(norm),
        savedAt: new Date().toISOString(),
      },
      ...list,
    ].slice(0, RECENT_MAX);
    writeRecent(next);
    return { success: true, recent: next };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("recent:remove", async (_event, p) => {
  try {
    if (typeof p !== "string" || !p.trim()) return { success: false, error: "Path inválido" };
    const norm = path.normalize(p);
    const list = readRecent().filter((r) => path.normalize(r.path) !== norm);
    writeRecent(list);
    return { success: true, recent: list };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("project:load", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Cargar proyecto Beru",
    properties: ["openFile"],
    filters: [{ name: "Proyecto Beru", extensions: ["beru.json", "json"] }],
  });
    if (canceled || !filePaths || filePaths.length === 0) return { success: false, canceled: true };
  pathSecurity.registerAllowedPath(filePaths[0]);
  const check = pathSecurity.validateReadableFile(filePaths[0], "project");
  if (!check.ok) return { success: false, error: check.error };
  try {
    const raw = fs.readFileSync(check.resolvedPath, "utf8");
    const data = JSON.parse(raw);
    return { success: true, filePath: check.resolvedPath, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("project:loadFromPath", async (_event, filePath) => {
  const check = pathSecurity.validateReadableFile(filePath, "project");
  if (!check.ok) return { success: false, error: check.error };
  try {
    if (!fs.existsSync(check.resolvedPath)) {
      return { success: false, error: "Archivo no encontrado", missing: true };
    }
    const raw = fs.readFileSync(check.resolvedPath, "utf8");
    const data = JSON.parse(raw);
    pathSecurity.registerAllowedPath(check.resolvedPath);
    return { success: true, filePath: check.resolvedPath, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("shell:showItemInFolder", async (_event, filePath) => {
  const check = pathSecurity.validateShellPath(filePath);
  if (!check.ok) return { success: false, error: check.error };
  shell.showItemInFolder(check.resolvedPath);
  return { success: true };
});

// ── App lifecycle ─────────────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  console.error("[beru] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[beru] unhandledRejection:", reason);
});

// ── Custom beru:// protocol ────────────────────────────────────────────────
// Lets the renderer load local files (e.g. <video src=...>) from any origin
// (Vite dev server on http://localhost:5173) without disabling webSecurity.
// Must be declared before app.whenReady().
protocol.registerSchemesAsPrivileged([
  { scheme: "beru", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

function registerBeruProtocol() {
  protocol.handle("beru", async (request) => {
    try {
      const url = new URL(request.url);
      // beru://local/<percent-encoded-absolute-path>  e.g. beru://local/C%3A%5Cvideos%5Cclip.mp4
      let absPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (process.platform === "win32" && /^\/[A-Za-z]:/.test(url.pathname)) {
        absPath = absPath.replace(/^([A-Za-z]:)/, "$1");
      }
      if (!absPath || !fs.existsSync(absPath)) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(absPath).toString());
    } catch (err) {
      console.error("[beru] beru:// handler error:", err);
      return new Response("Internal error", { status: 500 });
    }
  });
}

app.whenReady().then(() => {
  registerBeruProtocol();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Updater IPCs ───────────────────────────────────────────────────────────

ipcMain.handle("updater:check", async () => {
  return await updater.checkForUpdates();
});

ipcMain.handle("updater:download", async () => {
  return await updater.startDownload();
});

ipcMain.handle("updater:install", () => {
  updater.install();
  return { ok: true };
});

ipcMain.handle("updater:checkGitHub", async () => {
  return await updater.checkGitHubRelease();
});

ipcMain.handle("shell:openExternal", async (_event, url) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { success: false, error: "URL inválida" };
  }
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

