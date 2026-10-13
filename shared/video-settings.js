import { normalizeAudio } from "./audio-settings.js";
import { normalizeTransform } from "./video-transform.js";
import { normalizeAudioAsset } from "./audio-asset.js";
import { normalizeTiming } from "./clip-timeline.js";

export function normalizeVideoSettings(item) {
  return {
    transform: normalizeTransform(item?.transform),
    audio: normalizeAudio(item?.audio),
    externalAudio: normalizeAudioAsset(item?.externalAudio),
    timing: normalizeTiming(item?.timing),
  };
}
