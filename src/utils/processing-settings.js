const ENCODE_PROFILES = new Set(["fast", "balanced", "quality", "uquality"]);
const MAX_BATCH_WORKERS = 16;

export function normalizeEncodeProfile(value) {
  return ENCODE_PROFILES.has(value) ? value : "balanced";
}

export function normalizeBatchWorkers(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_BATCH_WORKERS, Math.floor(n))) : 0;
}

export function normalizeBatchWorkersMode(value) {
  return value === "conservative" ? "conservative" : "balanced";
}
