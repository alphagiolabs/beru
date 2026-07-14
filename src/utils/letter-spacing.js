/** Letter spacing as CSS-like pixels (preview + job export). */

/** Shared clamp range for preview, normalizeTextStyle, and FFmpeg export. */
export const LETTER_SPACING_MIN = -20;
export const LETTER_SPACING_MAX = 80;

export function letterSpacingToPx(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(LETTER_SPACING_MAX, Math.max(LETTER_SPACING_MIN, n));
}
