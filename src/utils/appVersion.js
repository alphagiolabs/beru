/* global __APP_VERSION__ */
/** Current app semver from package.json (injected at build time). */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

function normalizeReleaseNoteLines(notes) {
  if (!notes) return [];
  const text = String(notes)
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*•#]+\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^#{1,6}\s/.test(line));
}

const WHATS_NEW_HEADER = /^(what'?s?\s*new|novedades|features?|added|mejoras?)\b/i;
const FIXED_HEADER = /^(fixed?|fixes|corregid[oa]s?|bugs?)\b/i;
const FIX_PREFIX = /^(fix(\([^)]+\))?:|bug:|hotfix:)/i;
const FEAT_PREFIX =
  /^(feat(\([^)]+\))?:|add:|new:|ui\+tests:|refactor(\([^)]+\))?:|chore(\([^)]+\))?:)/i;

function classifyReleaseNoteLine(line, activeSection) {
  if (WHATS_NEW_HEADER.test(line)) return { kind: "header", section: "whatsNew" };
  if (FIXED_HEADER.test(line)) return { kind: "header", section: "fixed" };
  if (activeSection) return { kind: "item", section: activeSection, text: line };
  if (FIX_PREFIX.test(line)) return { kind: "item", section: "fixed", text: line };
  if (FEAT_PREFIX.test(line)) return { kind: "item", section: "whatsNew", text: line };
  return { kind: "item", section: "whatsNew", text: line };
}

/** Strip HTML/markdown noise and return bullet-ready lines. */
export function parseReleaseNotes(notes, maxItems = 6) {
  return normalizeReleaseNoteLines(notes).slice(0, maxItems);
}

/** Group release notes into Hermes-style changelog sections. */
export function parseReleaseNotesSections(notes, maxPerSection = 4) {
  const buckets = { whatsNew: [], fixed: [] };
  let activeSection = null;

  for (const line of normalizeReleaseNoteLines(notes)) {
    const parsed = classifyReleaseNoteLine(line, activeSection);
    if (parsed.kind === "header") {
      activeSection = parsed.section;
      continue;
    }
    buckets[parsed.section].push(parsed.text);
  }

  const whatsNew = buckets.whatsNew.slice(0, maxPerSection);
  const fixed = buckets.fixed.slice(0, maxPerSection);
  const total = buckets.whatsNew.length + buckets.fixed.length;
  const shown = whatsNew.length + fixed.length;

  return {
    whatsNew,
    fixed,
    hiddenCount: Math.max(0, total - shown),
  };
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
