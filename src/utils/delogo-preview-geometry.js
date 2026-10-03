export function logoSourceRect(region, video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sx = Math.max(0, Math.min(vw - 1, Math.round(region.x * vw)));
  const sy = Math.max(0, Math.min(vh - 1, Math.round(region.y * vh)));
  return {
    sx,
    sy,
    sw: Math.max(1, Math.min(vw - sx, Math.round(region.w * vw))),
    sh: Math.max(1, Math.min(vh - sy, Math.round(region.h * vh))),
  };
}

export function paddedLogoRect(rect, video, pad, alignment = 2) {
  const sx = Math.floor(Math.max(0, rect.sx - pad) / alignment) * alignment;
  const sy = Math.floor(Math.max(0, rect.sy - pad) / alignment) * alignment;
  const right = Math.min(
    video.videoWidth,
    Math.ceil((rect.sx + rect.sw + pad) / alignment) * alignment,
  );
  const bottom = Math.min(
    video.videoHeight,
    Math.ceil((rect.sy + rect.sh + pad) / alignment) * alignment,
  );
  return { sx, sy, sw: right - sx, sh: bottom - sy };
}

export function logoPreviewGeometry(region, video, feather, method) {
  const selection = logoSourceRect(region, video);
  const reconstructing = ["inpaint", "temporal"].includes(method);
  const repair = reconstructing ? paddedLogoRect(selection, video, 2, 1) : selection;
  const pad = reconstructing
    ? Math.max(2, feather, Math.ceil(Math.max(video.videoWidth / 1280, video.videoHeight / 720)))
    : feather;
  const effect = paddedLogoRect(repair, video, pad);
  return {
    selection,
    repair,
    effect,
    region: {
      x: effect.sx / video.videoWidth,
      y: effect.sy / video.videoHeight,
      w: effect.sw / video.videoWidth,
      h: effect.sh / video.videoHeight,
    },
  };
}
