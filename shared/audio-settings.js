export const IDENTITY_AUDIO = Object.freeze({ gain: 1, muted: false });

export function normalizeGain(value) {
  const gain = value == null || (typeof value === "string" && !value.trim()) ? NaN : Number(value);
  return Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 1;
}

export function normalizeAudio(value) {
  return { gain: normalizeGain(value?.gain), muted: value?.muted === true };
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
