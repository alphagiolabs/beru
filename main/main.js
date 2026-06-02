import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from "electron";
import { spawn, exec } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import * as updater from "./updater.js";
import { probeVideoFile } from "./videoProbe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

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
  return isDev
    ? path.join(__dirname, "..", "src-tauri", "bin", "ffprobe.exe")
    : path.join(process.resourcesPath, "bin", "ffprobe.exe");
}

function getFfmpegPath() {
  return isDev
    ? path.join(__dirname, "..", "src-tauri", "bin", "ffmpeg.exe")
    : path.join(process.resourcesPath, "bin", "ffmpeg.exe");
}

const videoInfoCache = new Map();

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
  if (mtime >= 0) videoInfoCache.set(filePath, { mtime, info });
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
  return filePaths;
});

ipcMain.handle("dialog:openExcel", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Seleccionar archivo Excel",
    filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return null;
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
  try {
    return await probeVideo(filePath);
  } catch {
    return { exists: true, width: 0, height: 0, duration: 0 };
  }
});

ipcMain.handle("fs:getVideoInfoBatch", async (_event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
  const cpus = os.cpus()?.length || 4;
  const limit = Math.max(2, Math.min(16, filePaths.length, cpus * 2));
  return await runWithConcurrency(filePaths, limit, probeVideoFast);
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
  return await extractThumbnail(filePath, 80);
});

ipcMain.handle("video:thumbnailBatch", async (_event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
  const cpus = os.cpus()?.length || 4;
  const limit = Math.max(2, Math.min(8, filePaths.length, cpus));
  return await runWithConcurrency(filePaths, limit, (p) => extractThumbnail(p, 80));
});

ipcMain.handle("fs:readExcel", async (_event, filePath) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return { data: buffer.toString("base64"), name: path.basename(filePath) };
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

    isProcessing = true;
    lastProcessingError = null;

    const uid = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    currentTmpFile = path.join(app.getPath("temp"), `beru-jobs-${uid}.json`);
    const cancelFile = currentTmpFile.replace(".json", ".cancel");
    try { fs.unlinkSync(cancelFile); } catch {}
    await fs.promises.writeFile(currentTmpFile, JSON.stringify(jobs));

    const firstProfile = jobs[0]?.encode_profile || "balanced";
    let workerCount = "0";
    const settings = readSettings();
    if (Number(settings.batchWorkers) > 0) {
      workerCount = String(Math.min(8, Math.floor(Number(settings.batchWorkers))));
    }

    const py = resolvePythonSpawn();
    pythonProcess = spawn(py.command, [...py.args, scriptPath, currentTmpFile], {
      windowsHide: true,
      env: {
        ...process.env,
        BERU_WORKERS: workerCount,
        BERU_ENCODE_PROFILE: firstProfile,
        BERU_FFMPEG: getFfmpegPath(),
        BERU_FFPROBE: getFfprobePath(),
      },
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
  if (!filePath) return { success: false, error: "No path provided" };
  if (!fs.existsSync(filePath)) {
    return { success: false, error: "Archivo no existe" };
  }
  const result = await shell.openPath(filePath);
  if (result) return { success: false, error: result };
  return { success: true };
});

ipcMain.handle("shell:showItemInFolder", async (_event, filePath) => {
  if (!filePath) return { success: false, error: "No path provided" };
  if (!fs.existsSync(filePath)) {
    return { success: false, error: "Archivo no existe" };
  }
  shell.showItemInFolder(filePath);
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
  if (!imagePath || typeof imagePath !== "string") {
    return { success: false, error: "Ruta inválida" };
  }
  if (!fs.existsSync(imagePath)) {
    return { success: false, error: "Archivo no encontrado" };
  }
  const ext = path.extname(imagePath).toLowerCase();
  const mime = IMAGE_MIMES[ext];
  if (!mime) {
    return { success: false, error: `Formato no soportado: ${ext}` };
  }
  try {
    const buf = fs.readFileSync(imagePath);
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

const SETTINGS_DEFAULTS = { theme: "dark", language: "es", encodeProfile: "balanced", batchWorkers: 0 };

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
  try {
    const raw = fs.readFileSync(filePaths[0], "utf8");
    const data = JSON.parse(raw);
    return { success: true, filePath: filePaths[0], data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("project:loadFromPath", async (_event, filePath) => {
  if (typeof filePath !== "string" || !filePath.trim()) {
    return { success: false, error: "Path inválido" };
  }
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: "Archivo no encontrado", missing: true };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return { success: true, filePath, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
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

