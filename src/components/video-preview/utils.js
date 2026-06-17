export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.25;

export const opModeColor = {
  text: "#a855f7",
  blur: "#00f0ea",
  delogo: "#f43f5e",
  crop: "#fbbf24",
  image: "#10b981",
};

export const isOpActive = (op, t) => {
  const s = op.startTime;
  const e = op.endTime;
  if (s == null && e == null) return true;
  if (s != null && t < s) return false;
  if (e != null && t > e) return false;
  return true;
};

export function resolvedDuration(video, fallback) {
  const mediaDuration = Number(video?.duration);
  if (Number.isFinite(mediaDuration) && mediaDuration > 0) return mediaDuration;
  const fallbackDuration = Number(fallback);
  return Number.isFinite(fallbackDuration) && fallbackDuration > 0 ? fallbackDuration : 0;
}
