/** Letter spacing as CSS-like pixels (preview + job export). */
export function letterSpacingToPx(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** FFmpeg drawtext `spacing` is integer pixels; negative values are not supported. */
export function letterSpacingForFfmpeg(value) {
  return Math.round(Math.max(0, letterSpacingToPx(value)));
}
