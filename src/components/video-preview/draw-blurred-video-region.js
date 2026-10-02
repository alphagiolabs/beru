export function drawBlurredVideoRegion(ctx, video, region, screen, blurStrength) {
  if (!ctx || !video || !region || !screen || !video.videoWidth || !video.videoHeight) {
    return false;
  }

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const sourceX = Math.max(0, Math.min(videoWidth - 1, Math.round(region.x * videoWidth)));
  const sourceY = Math.max(0, Math.min(videoHeight - 1, Math.round(region.y * videoHeight)));
  const sourceWidth = Math.max(
    1,
    Math.min(videoWidth - sourceX, Math.round(region.w * videoWidth)),
  );
  const sourceHeight = Math.max(
    1,
    Math.min(videoHeight - sourceY, Math.round(region.h * videoHeight)),
  );
  const requestedRadius = Math.max(1, Math.floor((Number(blurStrength) || 20) / 3));
  const radiusVideo = Math.max(
    1,
    Math.min(requestedRadius, Math.floor(Math.min(sourceWidth, sourceHeight) / 2)),
  );
  const padding = radiusVideo * 2;
  const paddedX = Math.max(0, sourceX - padding);
  const paddedY = Math.max(0, sourceY - padding);
  const paddedRight = Math.min(videoWidth, sourceX + sourceWidth + padding);
  const paddedBottom = Math.min(videoHeight, sourceY + sourceHeight + padding);
  const scaleX = screen.sx || screen.w / sourceWidth;
  const scaleY = screen.sy || screen.h / sourceHeight;
  const blurPx = Math.max(0.5, radiusVideo * Math.max(scaleX, scaleY));

  ctx.save();
  ctx.clearRect(0, 0, screen.w, screen.h);
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(
    video,
    paddedX,
    paddedY,
    paddedRight - paddedX,
    paddedBottom - paddedY,
    (paddedX - sourceX) * scaleX,
    (paddedY - sourceY) * scaleY,
    (paddedRight - paddedX) * scaleX,
    (paddedBottom - paddedY) * scaleY,
  );
  ctx.restore();
  return true;
}
