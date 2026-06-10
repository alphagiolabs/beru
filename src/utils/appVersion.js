/* global __APP_VERSION__ */
/** Current app semver from package.json (injected at build time). */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

/** Strip HTML/markdown noise and return bullet-ready lines. */
export function parseReleaseNotes(notes, maxItems = 6) {
  if (!notes) return [];
  const text = String(notes)
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^[-*•#]+\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^#{1,6}\s/.test(line));
  return lines.slice(0, maxItems);
}

/** Format elapsed ms as HH:MM for footer clocks. */
export function formatFooterClock(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
