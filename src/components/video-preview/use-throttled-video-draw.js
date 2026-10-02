import { useEffect } from "react";
import { PERF_FLAGS } from "../../utils/perf-flags.js";
import { regionToScreen } from "../../utils/video-utils.js";

export function useThrottledVideoDraw({
  enabled = true,
  videoRef,
  canvasRef,
  getRegion,
  paint,
  afterDraw = null,
  resumeEvents = ["play", "seeked", "loadeddata"],
  deps = [],
}) {
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let timerId = 0;
    let lastDrawTs = 0;
    let pauseController = null;
    const throttleFps = PERF_FLAGS.delogoThrottleFps;
    const throttleInterval = throttleFps > 0 ? 1000 / throttleFps : 0;

    const scheduleNext = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(draw);
    };

    const draw = () => {
      rafId = 0;
      timerId = 0;
      const video = videoRef.current;
      const region = getRegion();
      if (document.hidden) {
        timerId = setTimeout(draw, 1000);
        return;
      }
      if (!video || !region || video.readyState < 2) {
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
      paint(ctx, video, region, screen);
      afterDraw?.(screen, video);

      if (video.paused) {
        if (!pauseController) {
          pauseController = new AbortController();
          const resume = () => {
            pauseController?.abort();
            pauseController = null;
            scheduleNext();
          };
          for (const eventName of resumeEvents) {
            video.addEventListener(eventName, resume, {
              once: true,
              signal: pauseController.signal,
            });
          }
        }
        return;
      }
      scheduleNext();
    };

    scheduleNext();
    const video = videoRef.current;
    const resizeObserver =
      video && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (video.paused) {
              clearTimeout(timerId);
              cancelAnimationFrame(rafId);
              rafId = 0;
              scheduleNext();
            }
          })
        : null;
    resizeObserver?.observe(video);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      pauseController?.abort();
      resizeObserver?.disconnect();
    };
  }, [enabled, videoRef, canvasRef, ...deps]);
}
