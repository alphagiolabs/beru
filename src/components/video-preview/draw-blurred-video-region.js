import { logoSourceRect } from "../../utils/delogo-preview-geometry.js";

export function drawBlurredVideoRegion(ctx, video, region, screen, blurStrength) {
  if (!ctx || !video || !region || !screen || !video.videoWidth || !video.videoHeight) {
    return false;
  }

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const {
    sx: sourceX,
    sy: sourceY,
    sw: sourceWidth,
    sh: sourceHeight,
  } = logoSourceRect(region, video);
  const requestedRadius = Math.max(1, Math.floor((Number(blurStrength) || 20) / 3));
  const radiusVideo = Math.min(33, requestedRadius);
  const padding = radiusVideo * 3;
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
