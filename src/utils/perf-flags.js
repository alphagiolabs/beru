/**
 * Renderer-side performance feature flags.
 *
 * Vite only exposes env vars prefixed with `VITE_` to the client bundle, so every
 * flag below is read from `import.meta.env.VITE_BERU_*`. All flags default to the
 * current (pre-optimization) behaviour unless explicitly enabled, so each change
 * is opt-in and safely revertable without a code change.
 *
 * Convention: truthy values are "1", "true" or a positive number. Anything else
 * is falsy. Use the typed accessors instead of reading `import.meta.env` directly.
 */

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};

function flagRaw(key) {
  return env[key];
}

/** Truthy if the env var is "1", "true" (case-insensitive). */
function flagBool(key, fallback = false) {
  const raw = flagRaw(key);
  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).toLowerCase() === "1" || String(raw).toLowerCase() === "true";
}

/** Numeric env var, clamped to >= 0; returns `fallback` when unset/invalid. */
function flagNumber(key, fallback = 0) {
  const raw = flagRaw(key);
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const PERF_FLAGS = {
  /**
   * Track per-job encode progress in a standalone `jobProgress` map instead of
   * mutating `queue` on every progress tick. Keeps `queue` referentially stable
   * during processing so subscribers that only need `queue` don't re-render.
   */
  progressMap: flagBool("VITE_BERU_RENDER_PROGRESS_MAP", false),

  /**
   * Virtualize the queue sidebar list (`@tanstack/react-virtual`) when the queue
   * exceeds `virtualizeThreshold` items.
   */
  virtualize: flagBool("VITE_BERU_RENDER_VIRTUALIZE", false),
  virtualizeThreshold: flagNumber("VITE_BERU_RENDER_VIRTUALIZE_THRESHOLD", 100),

  /** Target FPS for the delogo live-preview RAF loop. 0 = uncapped (legacy). */
  delogoThrottleFps: flagNumber("VITE_BERU_DELGO_THROTTLE_FPS", 30),

  /** Use quickselect (O(n)) instead of full sort for the temporal median. */
  delogoQuickselect: flagBool("VITE_BERU_DELGO_QUICKSELECT", false),

  /** Coalesce `appendLog` calls in `useProcessing` into 50ms batches. */
  logBatch: flagBool("VITE_BERU_LOG_BATCH", true),
};

/** Re-read flags (mainly for tests that mutate `import.meta.env`). */
export function reloadPerfFlags() {
  PERF_FLAGS.progressMap = flagBool("VITE_BERU_RENDER_PROGRESS_MAP", false);
  PERF_FLAGS.virtualize = flagBool("VITE_BERU_RENDER_VIRTUALIZE", false);
  PERF_FLAGS.virtualizeThreshold = flagNumber("VITE_BERU_RENDER_VIRTUALIZE_THRESHOLD", 100);
  PERF_FLAGS.delogoThrottleFps = flagNumber("VITE_BERU_DELGO_THROTTLE_FPS", 30);
  PERF_FLAGS.delogoQuickselect = flagBool("VITE_BERU_DELGO_QUICKSELECT", false);
  PERF_FLAGS.logBatch = flagBool("VITE_BERU_LOG_BATCH", true);
}
