import { reconcileBatchExport } from "./batch-export.js";
import { persistWatermark, restoreWatermark } from "./sanitize-preset.js";
import { swallow } from "./swallow.js";

export const SESSION_PERSIST_KEY = "beru-queue-session";
const SESSION_PERSIST_VERSION = 1;

function sanitizeQueueItem(item) {
  if (!item?.path) return null;
  return {
    path: item.path,
    src: item.src,
    filename: item.filename,
    width: item.width || 0,
    height: item.height || 0,
    sourceWidth: item.sourceWidth || 0,
    sourceHeight: item.sourceHeight || 0,
    duration: item.duration || 0,
    pixFmt: item.pixFmt || "",
    frameRate: item.frameRate || 0,
    videoCodec: item.videoCodec || "",
    audioCodec: item.audioCodec || "",
    audioChannels: item.audioChannels || 0,
    trimStart: item.trimStart ?? null,
    trimEnd: item.trimEnd ?? null,
    operations: item.operations || [],
    customOutputName: item.customOutputName || "",
  };
}

function restoreQueueItem(item) {
  return {
    ...item,
    status: "idle",
    progress: 0,
    error: null,
    thumbnail: null,
  };
}

const asArray = (value) => (Array.isArray(value) ? value : []);
const symmetric = (normalize) => ({ save: normalize, restore: normalize });

const SESSION_PERSIST_FIELDS = {
  queue: {
    save: (items) => (Array.isArray(items) ? items : []).map(sanitizeQueueItem).filter(Boolean),
    restore: (items) =>
      (Array.isArray(items) ? items : []).filter((item) => item?.path).map(restoreQueueItem),
  },
  outputDir: symmetric((v) => v || null),
  templateRegions: symmetric(asArray),
  selectedTemplateRegionId: symmetric((v) => v ?? null),
  nextRegionLabel: symmetric((v) => v ?? 1),
  excelPath: symmetric((v) => v || null),
  excelHeaders: symmetric(asArray),
  excelRows: symmetric(asArray),
  excelMapping: symmetric((v) => v || { idColumn: null, columns: {} }),
  watermark: { save: persistWatermark, restore: restoreWatermark, optional: true },
};

export const SESSION_PERSIST_KEYS = Object.keys(SESSION_PERSIST_FIELDS);

export function hasPersistedFieldChanged(state, prev) {
  return SESSION_PERSIST_KEYS.some((key) => state[key] !== prev[key]);
}

export function buildSessionSnapshot(state) {
  const snapshot = { version: SESSION_PERSIST_VERSION };
  for (const key of SESSION_PERSIST_KEYS) {
    snapshot[key] = SESSION_PERSIST_FIELDS[key].save(state?.[key]);
  }
  return snapshot.queue.length === 0 ? null : snapshot;
}

/**
 * @param {unknown} raw parsed JSON from sessionStorage
 * @returns {object|null} store patch fields, or null if invalid/empty
 */
export function parseSessionSnapshot(raw) {
  const legacy = Array.isArray(raw);
  const source = legacy ? {} : raw;
  const queue = SESSION_PERSIST_FIELDS.queue.restore(legacy ? raw : source?.queue);
  if (queue.length === 0) return null;

  const restored = { queue, selectedIdx: 0 };
  for (const key of SESSION_PERSIST_KEYS) {
    if (key === "queue") continue;
    const field = SESSION_PERSIST_FIELDS[key];
    const value = field.restore(source?.[key]);
    if (field.optional && !value) continue;
    restored[key] = value;
  }

  return { ...restored, ...reconcileBatchExport(restored).patch };
}

function defaultSessionStorage() {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function readSessionSnapshotFromStorage(storage = defaultSessionStorage()) {
  try {
    if (!storage) return null;
    const raw = storage.getItem(SESSION_PERSIST_KEY);
    if (!raw) return null;
    return parseSessionSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

let _lastSessionJson = null;
let _lastExcelRowsRef = null;
let _lastExcelRowsJson = "[]";
let _writeFailureLogged = false;

export function writeSessionSnapshotToStorage(state, storage = defaultSessionStorage()) {
  try {
    if (!storage) return;
    const snapshot = buildSessionSnapshot(state);
    if (!snapshot) {
      storage.removeItem(SESSION_PERSIST_KEY);
      _lastSessionJson = null;
      return;
    }
    if (snapshot.excelRows !== _lastExcelRowsRef) {
      _lastExcelRowsRef = snapshot.excelRows;
      _lastExcelRowsJson = JSON.stringify(snapshot.excelRows);
    }
    const { excelRows: _rows, ...rest } = snapshot;
    const restJson = JSON.stringify(rest);
    const json = `${restJson.slice(0, -1)},"excelRows":${_lastExcelRowsJson}}`;
    if (json === _lastSessionJson) return;
    storage.setItem(SESSION_PERSIST_KEY, json);
    _lastSessionJson = json;
    _writeFailureLogged = false;
  } catch (error) {
    if (!_writeFailureLogged) {
      _writeFailureLogged = true;
      swallow("Session persist", error);
    }
  }
}

export function resetSessionWriteCache() {
  _lastSessionJson = null;
  _lastExcelRowsRef = null;
  _lastExcelRowsJson = "[]";
  _writeFailureLogged = false;
}
