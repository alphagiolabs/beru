export const MIN_PX_PER_SECOND = 2;
export const MAX_PX_PER_SECOND = 480;
export const DEFAULT_PX_PER_SECOND = 40;
export const SNAP_THRESHOLD_PX = 6;
export const MIN_CLIP_US = 40_000;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const clampZoom = (pxPerSecond) => clamp(pxPerSecond, MIN_PX_PER_SECOND, MAX_PX_PER_SECOND);

export function fitPxPerSecond(durationUs, widthPx) {
  if (!(durationUs > 0) || !(widthPx > 0)) return DEFAULT_PX_PER_SECOND;
  return clampZoom(widthPx / (durationUs / 1_000_000));
}

export const usToPx = (us, pxPerSecond) => (us / 1_000_000) * pxPerSecond;
export const pxToUs = (px, pxPerSecond) => Math.round((px / pxPerSecond) * 1_000_000);

export function snapTime(timeUs, candidates, pxPerSecond, thresholdPx = SNAP_THRESHOLD_PX) {
  let best = timeUs;
  let bestDistance = thresholdPx;
  for (const candidate of candidates) {
    const distance = Math.abs(usToPx(candidate - timeUs, pxPerSecond));
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function snapCandidates(layout, playheadUs, excludeClipId = null) {
  const points = [0, playheadUs];
  for (const { clip, startUs, endUs } of layout) {
    if (clip.id === excludeClipId) continue;
    points.push(startUs, endUs);
  }
  return points;
}

export function dropIndex(layout, centerUs, draggedClipId) {
  return layout.filter(
    (entry) => entry.clip.id !== draggedClipId && (entry.startUs + entry.endUs) / 2 < centerUs,
  ).length;
}

export function trimmedWindow(clip, edge, deltaUs, assetDurationUs) {
  const sourceDelta = Math.round(deltaUs * clip.speed);
  if (edge === "start") {
    const upper = Math.max(0, clip.sourceOutUs - MIN_CLIP_US);
    return {
      sourceInUs: clamp(clip.sourceInUs + sourceDelta, 0, upper),
      sourceOutUs: clip.sourceOutUs,
    };
  }
  const upper = assetDurationUs ?? Number.POSITIVE_INFINITY;
  return {
    sourceInUs: clip.sourceInUs,
    sourceOutUs: clamp(clip.sourceOutUs + sourceDelta, clip.sourceInUs + MIN_CLIP_US, upper),
  };
}

export function isInView(startPx, endPx, scrollLeft, viewportWidth, marginPx = 240) {
  return endPx >= scrollLeft - marginPx && startPx <= scrollLeft + viewportWidth + marginPx;
}

export function overlayWindow(overlay, mode, deltaUs, snap = (us) => us) {
  const { startUs, endUs } = overlay;
  if (mode === "move") {
    const nextStart = Math.max(0, snap(startUs + deltaUs));
    return { startUs: nextStart, endUs: nextStart + (endUs - startUs) };
  }
  if (mode === "start") {
    return { startUs: clamp(snap(startUs + deltaUs), 0, endUs - MIN_CLIP_US), endUs };
  }
  return { startUs, endUs: Math.max(startUs + MIN_CLIP_US, snap(endUs + deltaUs)) };
}
