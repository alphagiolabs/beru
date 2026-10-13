export const IDENTITY_AUDIO = Object.freeze({ gain: 1, muted: false });

export function normalizeAudio(value) {
  const rawGain = value?.gain;
  const gain =
    rawGain == null || (typeof rawGain === "string" && !rawGain.trim()) ? NaN : Number(rawGain);
  return {
    gain: Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 1,
    muted: value?.muted === true,
  };
}

export function audioSettingsEqual(a, b) {
  const x = normalizeAudio(a),
    y = normalizeAudio(b);
  return x.gain === y.gain && x.muted === y.muted;
}

export function audioJobFields(value) {
  const audio = normalizeAudio(value);
  return { audio_gain: audio.gain, audio_muted: audio.muted };
}
