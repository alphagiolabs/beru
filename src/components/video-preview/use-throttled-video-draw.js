import { useEffect } from "react";
import { PERF_FLAGS } from "../../utils/perf-flags.js";
import { regionToScreen } from "../../utils/video-utils.js";

export function useThrottledVideoDraw({
  enabled = true,
  videoRef,
  canvasRef,
  getRegion,
  paint,
  syncFrames = false,
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
    let videoFrameId = 0;
    let lastDrawTs = 0;
    const throttleFps = PERF_FLAGS.delogoThrottleFps;
    const throttleInterval = throttleFps > 0 ? 1000 / throttleFps : 0;

    const scheduleNext = () => {
      if (rafId || videoFrameId) return;
      const video = videoRef.current;
      if (!video?.paused && typeof video?.requestVideoFrameCallback === "function") {
        videoFrameId = video.requestVideoFrameCallback((now, frame) => draw(frame));
      } else rafId = requestAnimationFrame(() => draw());
    };

    const draw = (frame = null) => {
      rafId = 0;
      videoFrameId = 0;
      timerId = 0;
      const video = videoRef.current;
      const region = getRegion();
      if (document.hidden) {
        timerId = setTimeout(draw, 1000);
        return;
      }
      if (!video || !region || video.readyState < 2 || video.seeking) {
        timerId = setTimeout(draw, 100);
        return;
      }
      if (throttleInterval > 0) {
        const now = performance.now();
        const remaining = throttleInterval - (now - lastDrawTs);
        if (remaining > 0) {
          if (syncFrames && frame) frame = { ...frame, skipWorker: true };
          else {
            timerId = setTimeout(scheduleNext, remaining);
            return;
          }
        } else lastDrawTs = now;
      }

      const screen = regionToScreen(region, video);
      if (!screen || screen.w < 1 || screen.h < 1) {
        scheduleNext();
        return;
      }

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const left = Math.floor(screen.x * dpr),
        top = Math.floor(screen.y * dpr);
      const backingWidth = Math.max(1, Math.ceil((screen.x + screen.w) * dpr) - left);
      const backingHeight = Math.max(1, Math.ceil((screen.y + screen.h) * dpr) - top);
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      canvas.style.left = `${left / dpr}px`;
      canvas.style.top = `${top / dpr}px`;
      canvas.style.width = `${backingWidth / dpr}px`;
      canvas.style.height = `${backingHeight / dpr}px`;

      const ctx = canvas.getContext("2d");
      if (typeof ctx.setTransform === "function") {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, backingWidth, backingHeight);
        ctx.setTransform(dpr, 0, 0, dpr, screen.x * dpr - left, screen.y * dpr - top);
      }
      paint(ctx, video, region, screen, frame);
      afterDraw?.(screen, video);

      if (!video.paused) scheduleNext();
    };

    const video = videoRef.current;
    const cancelDraw = () => {
      cancelAnimationFrame(rafId);
      video?.cancelVideoFrameCallback?.(videoFrameId);
      clearTimeout(timerId);
      rafId = 0;
      videoFrameId = 0;
      timerId = 0;
    };
    const refresh = () => {
      cancelDraw();
      lastDrawTs = 0;
      rafId = requestAnimationFrame(() => draw());
    };
    const events = new Set([...resumeEvents, "pause"]);
    for (const eventName of events) video?.addEventListener(eventName, refresh);
    video?.addEventListener("seeking", cancelDraw);
    scheduleNext();
    const resizeObserver =
      video && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (video.paused) {
              refresh();
            }
          })
        : null;
    resizeObserver?.observe(video);
    return () => {
      cancelDraw();
      for (const eventName of events) video?.removeEventListener(eventName, refresh);
      video?.removeEventListener("seeking", cancelDraw);
      resizeObserver?.disconnect();
    };
  }, [enabled, videoRef, canvasRef, syncFrames, ...deps]);
}
