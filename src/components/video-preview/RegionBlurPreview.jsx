import { useEffect, useRef } from "react";
import { PERF_FLAGS } from "../../utils/perf-flags.js";
import { regionToScreen } from "../../utils/video-utils.js";
import { drawBlurredVideoRegion } from "./draw-blurred-video-region.js";

export default function RegionBlurPreview({
  videoRef,
  region,
  blurStrength = 20,
  outline = "1px dashed rgba(59,130,246,0.75)",
  zIndex = 10,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let timerId = 0;
    let lastDrawTs = 0;
    let pauseController = null;
    const throttleFps = PERF_FLAGS.delogoThrottleFps;
    const throttleInterval = throttleFps > 0 ? 1000 / throttleFps : 0;

    const scheduleNext = () => {
      rafId = requestAnimationFrame(draw);
    };

    const draw = () => {
      const video = videoRef.current;
      if (document.hidden) {
        timerId = setTimeout(draw, 1000);
        return;
      }
      if (!video || video.readyState < 2) {
        timerId = setTimeout(draw, 100);
        return;
      }
      if (throttleInterval > 0) {
        const now = performance.now();
        const remaining = throttleInterval - (now - lastDrawTs);
        if (remaining > 0) {
          timerId = setTimeout(draw, remaining);
          return;
        }
        lastDrawTs = now;
      }

      const screen = regionToScreen(region, video);
      if (!screen || screen.w < 1 || screen.h < 1) {
        scheduleNext();
        return;
      }

      const width = Math.max(1, Math.round(screen.w));
      const height = Math.max(1, Math.round(screen.h));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const backingWidth = Math.max(1, Math.round(width * dpr));
      const backingHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      canvas.style.left = `${screen.x}px`;
      canvas.style.top = `${screen.y}px`;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (typeof ctx.setTransform === "function") {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      drawBlurredVideoRegion(ctx, video, region, screen, blurStrength);

      if (video.paused) {
        if (!pauseController) {
          pauseController = new AbortController();
          const resume = () => {
            pauseController = null;
            scheduleNext();
          };
          video.addEventListener("play", resume, { once: true, signal: pauseController.signal });
          video.addEventListener("seeked", resume, { once: true, signal: pauseController.signal });
          video.addEventListener("loadeddata", resume, {
            once: true,
            signal: pauseController.signal,
          });
        }
        return;
      }
      scheduleNext();
    };

    scheduleNext();
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      pauseController?.abort();
    };
  }, [videoRef, region, blurStrength]);

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
