// @ts-check
// Vite only inlines import.meta.env.VITE_* into the client bundle.

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};

function flagRaw(key) {
  return env[key];
}

function flagBool(key, fallback = false) {
  const raw = flagRaw(key);
  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).toLowerCase() === "1" || String(raw).toLowerCase() === "true";
}

function flagNumber(key, fallback = 0) {
  const raw = flagRaw(key);
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const PERF_FLAGS = {
  progressMap: flagBool("VITE_BERU_RENDER_PROGRESS_MAP", true),
  virtualize: flagBool("VITE_BERU_RENDER_VIRTUALIZE", true),
  virtualizeThreshold: flagNumber("VITE_BERU_RENDER_VIRTUALIZE_THRESHOLD", 100),
  delogoThrottleFps: flagNumber("VITE_BERU_DELGO_THROTTLE_FPS", 30),
};
