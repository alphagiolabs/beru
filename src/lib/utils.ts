/**
 * Format seconds into a human-readable time string.
 * Examples:
 *   fmtTime(0)     → "0:00"
 *   fmtTime(90)    → "1:30"
 *   fmtTime(3661)  → "1:01:01"
 */
export function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Parse a resolution string like "1920x1080" into width and height.
 * Returns null if the string doesn't match the pattern.
 */
export function parseResolution(raw: string): { width: number; height: number } | null {
  const match = raw.match(/(\d{2,5})x(\d{2,5})/);
  if (!match) return null;
  return { width: parseInt(match[1]!), height: parseInt(match[2]!) };
}

/**
 * Calculate the ETA in seconds given remaining duration and current speed.
 * Returns null if speed is zero or negative.
 */
export function calcEta(remainingSeconds: number, speed: number): number | null {
  if (speed <= 0) return null;
  return remainingSeconds / speed;
}

/**
 * Clamp a number between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
