/**
 * Session snapshot for crash/relaunch recovery.
 * Persists queue + output dir + batch/Excel context in sessionStorage.
 */

export const SESSION_PERSIST_KEY = "beru-queue-session";
export const SESSION_PERSIST_VERSION = 1;

function sanitizeQueueItem(item) {
  if (!item?.path) return null;
  return {
    path: item.path,
    src: item.src,
    filename: item.filename,
    width: item.width || 0,
    height: item.height || 0,
    duration: item.duration || 0,
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

/**
 * @param {object} state
 * @returns {object|null} serializable snapshot, or null if nothing to keep
 */
function sanitizeWatermark(wm) {
  if (!wm || typeof wm !== "object") return null;
  return {
    enabled: !!wm.enabled,
    type: wm.type === "image" ? "image" : "text",
    text: typeof wm.text === "string" ? wm.text : "",
    imagePath: typeof wm.imagePath === "string" ? wm.imagePath : "",
    // imageDataUrl is display-only and can be huge — rehydrate from path if needed
    opacity: Number.isFinite(Number(wm.opacity)) ? Number(wm.opacity) : 0.5,
    scale: Number.isFinite(Number(wm.scale)) ? Number(wm.scale) : 1,
    position: typeof wm.position === "string" ? wm.position : "bottom-right",
    fontSize: Number.isFinite(Number(wm.fontSize)) ? Number(wm.fontSize) : 18,
    fontColor: typeof wm.fontColor === "string" ? wm.fontColor : "#ffffff",
    fontFamily: typeof wm.fontFamily === "string" ? wm.fontFamily : "Arial",
  };
}

export function buildSessionSnapshot(state) {
  const queue = (Array.isArray(state?.queue) ? state.queue : [])
    .map(sanitizeQueueItem)
    .filter(Boolean);
  if (queue.length === 0) return null;

  return {
    version: SESSION_PERSIST_VERSION,
    queue,
    outputDir: state.outputDir || null,
    templateRegions: Array.isArray(state.templateRegions) ? state.templateRegions : [],
    selectedTemplateRegionId: state.selectedTemplateRegionId ?? null,
    nextRegionLabel: state.nextRegionLabel ?? 1,
    excelPath: state.excelPath || null,
    excelHeaders: Array.isArray(state.excelHeaders) ? state.excelHeaders : [],
    excelRows: Array.isArray(state.excelRows) ? state.excelRows : [],
    excelMapping: state.excelMapping || { idColumn: null, columns: {} },
    excelMatchStatus: state.excelMatchStatus || {},
    excelRowIndexByFilename: state.excelRowIndexByFilename || {},
    watermark: sanitizeWatermark(state.watermark),
  };
}

/**
 * @param {unknown} raw parsed JSON from sessionStorage
 * @returns {object|null} store patch fields, or null if invalid/empty
 */
export function parseSessionSnapshot(raw) {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const queue = raw.filter((item) => item?.path).map(restoreQueueItem);
    if (queue.length === 0) return null;
    return {
      queue,
      selectedIdx: 0,
      outputDir: null,
      templateRegions: [],
      selectedTemplateRegionId: null,
      nextRegionLabel: 1,
      excelPath: null,
      excelHeaders: [],
      excelRows: [],
      excelMapping: { idColumn: null, columns: {} },
      excelMatchStatus: {},
      excelRowIndexByFilename: {},
    };
  }

  if (!raw || typeof raw !== "object" || !Array.isArray(raw.queue)) return null;
  const queue = raw.queue.filter((item) => item?.path).map(restoreQueueItem);
  if (queue.length === 0) return null;

  const watermark = sanitizeWatermark(raw.watermark);

  return {
    queue,
    selectedIdx: 0,
    outputDir: raw.outputDir || null,
    templateRegions: Array.isArray(raw.templateRegions) ? raw.templateRegions : [],
    selectedTemplateRegionId: raw.selectedTemplateRegionId ?? null,
    nextRegionLabel: raw.nextRegionLabel ?? 1,
    excelPath: raw.excelPath || null,
    excelHeaders: Array.isArray(raw.excelHeaders) ? raw.excelHeaders : [],
    excelRows: Array.isArray(raw.excelRows) ? raw.excelRows : [],
    excelMapping: raw.excelMapping || { idColumn: null, columns: {} },
    excelMatchStatus: raw.excelMatchStatus || {},
    excelRowIndexByFilename: raw.excelRowIndexByFilename || {},
    ...(watermark ? { watermark: { ...watermark, imageDataUrl: "" } } : {}),
  };
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

/** Last serialized payload — skip setItem when snapshot is unchanged (plan 014). */
let _lastSessionJson = null;

export function writeSessionSnapshotToStorage(state, storage = defaultSessionStorage()) {
  try {
    if (!storage) return;
    const snapshot = buildSessionSnapshot(state);
    if (!snapshot) {
      if (_lastSessionJson != null) {
        storage.removeItem(SESSION_PERSIST_KEY);
        _lastSessionJson = null;
      }
      return;
    }
    const json = JSON.stringify(snapshot);
    if (json === _lastSessionJson) return;
    storage.setItem(SESSION_PERSIST_KEY, json);
    _lastSessionJson = json;
  } catch {
    // sessionStorage may be full or unavailable
  }
}

/** Test helper: reset skip-equal cache. */
export function resetSessionWriteCache() {
  _lastSessionJson = null;
}
