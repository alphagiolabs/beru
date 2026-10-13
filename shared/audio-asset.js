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
  const rawGain = value.gain;
  const gain =
    rawGain == null || (typeof rawGain === "string" && !rawGain.trim()) ? 1 : Number(rawGain);
  return {
    path: value.path,
    name: typeof value.name === "string" ? value.name : value.path.split(/[\\/]/).at(-1),
    duration: Number.isFinite(Number(value.duration)) ? Math.max(0, Number(value.duration)) : 0,
    version: typeof value.version === "string" ? value.version : "",
    mode: value.mode === "replace" ? "replace" : "mix",
    offset,
    trimStart,
    trimEnd,
    gain: Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 1,
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
