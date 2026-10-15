export const SEEK_LIMIT_MS = 150;
export const SEEK_WINDOW = 12;
export const SEEK_MIN_SAMPLES = 8;

export function recordSeek(samples, ms) {
  return [...samples, ms].slice(-SEEK_WINDOW);
}

export function seekIsSlow(samples) {
  if (samples.length < SEEK_MIN_SAMPLES) return false;
  const sorted = [...samples].sort((a, b) => a - b);
  const p90 = sorted[Math.ceil(0.9 * sorted.length) - 1];
  return p90 > SEEK_LIMIT_MS;
}
