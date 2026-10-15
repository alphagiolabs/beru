import { useCallback, useRef } from "react";
import { drawBlurredVideoRegion } from "./draw-blurred-video-region.js";
import { useThrottledVideoDraw } from "./use-throttled-video-draw.js";
import { isOpActive } from "../../utils/operation.js";

export default function RegionBlurPreview({
  videoRef,
  region,
  blurStrength = 20,
  startTime = null,
  endTime = null,
  outline = "1px dashed rgba(59,130,246,0.75)",
  zIndex = 10,
}) {
  const canvasRef = useRef(null);
  const getRegion = useCallback(() => region, [region]);
  const paint = useCallback(
    (ctx, video, opRegion, screen) => {
      const active = isOpActive({ startTime, endTime }, video.currentTime);
      canvasRef.current.style.visibility = active ? "visible" : "hidden";
      if (active) drawBlurredVideoRegion(ctx, video, opRegion, screen, blurStrength);
      else ctx.clearRect(0, 0, screen.w, screen.h);
    },
    [blurStrength, startTime, endTime],
  );

  useThrottledVideoDraw({
    videoRef,
    canvasRef,
    getRegion,
    paint,
  });

  return (
    <canvas
      ref={canvasRef}
      className="absolute pointer-events-none rounded-sm"
      data-region-blur-preview
      style={{
        position: "absolute",
        pointerEvents: "none",
        borderRadius: "2px",
        zIndex,
        outline,
        outlineOffset: "-1px",
      }}
    />
  );
}
