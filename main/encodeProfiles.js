// Keep in sync with python/encode_profiles.py via resources/encode-profiles.json.

import contract from "../resources/encode-profiles.json" with { type: "json" };

const DEFAULT_PROFILE = "balanced";
const VALID_PROFILES = new Set(["fast", "balanced", "quality"]);

function normalizeProfiles(raw) {
  const profiles = {};
  for (const [name, spec] of Object.entries(raw.profiles || {})) {
    const key = String(name || "")
      .trim()
      .toLowerCase();
    if (!VALID_PROFILES.has(key)) continue;
    const software = spec.software || {};
    const entry = {
      crf: software.crf,
      preset: software.preset,
      allowsHardware: Boolean(spec.allowsHardware),
    };
    if (spec.hardware) {
      entry.hwCq = spec.hardware.hwCq;
      entry.nvencPreset = spec.hardware.nvencPreset;
    }
    profiles[key] = entry;
  }
  if (!profiles[DEFAULT_PROFILE]) {
    throw new Error(`encode-profiles.json must define ${DEFAULT_PROFILE}`);
  }
  return profiles;
}

export const ENCODE_PROFILES = normalizeProfiles(contract);

export function normalizeEncodeProfile(name) {
  const key = String(name || DEFAULT_PROFILE)
    .trim()
    .toLowerCase();
  return VALID_PROFILES.has(key) ? key : DEFAULT_PROFILE;
}

export function profileAllowsHardware(profileName) {
  const profile = normalizeEncodeProfile(profileName);
  return Boolean(ENCODE_PROFILES[profile]?.allowsHardware);
}

export function getEffectiveHwEncoder(profileName, hwEncoder) {
  if (!profileAllowsHardware(profileName)) {
    return null;
  }
  return hwEncoder || null;
}
