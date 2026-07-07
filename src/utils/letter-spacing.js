/** Letter spacing as CSS-like pixels (preview + job export). */
export function letterSpacingToPx(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
