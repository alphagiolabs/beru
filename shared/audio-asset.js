import { normalizeGain } from "./audio-settings.js";

const number = (value, fallback) => (value == null ? fallback : Number(value));

export function normalizeAudioAsset(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.path !== "string" ||
    !value.path.trim()
  )
    return null;
  const offset = number(value.offset, 0);
  const trimStart = number(value.trimStart, 0);
  const trimEnd = value.trimEnd == null ? null : Number(value.trimEnd);
  if (
    ![offset, trimStart].every((n) => Number.isFinite(n) && n >= 0) ||
    (trimEnd != null && (!Number.isFinite(trimEnd) || trimEnd <= trimStart))
  )
    return null;
  return {
    path: value.path,
    name: typeof value.name === "string" ? value.name : value.path.split(/[\\/]/).at(-1),
    duration: Number.isFinite(Number(value.duration)) ? Math.max(0, Number(value.duration)) : 0,
    version: typeof value.version === "string" ? value.version : "",
    mode: value.mode === "replace" ? "replace" : "mix",
    offset,
    trimStart,
    trimEnd,
    gain: normalizeGain(value.gain),
  };
}

export function audioAssetJob(value) {
  const asset = normalizeAudioAsset(value);
  return asset
    ? {
        path: asset.path,
        mode: asset.mode,
        offset: asset.offset,
        trim_start: asset.trimStart,
        trim_end: asset.trimEnd,
        gain: asset.gain,
      }
    : null;
}
