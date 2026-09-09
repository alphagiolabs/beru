import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyMove,
  applyResize,
  getContentPx,
  pointerDeltaToNorm,
} from "../utils/region-interaction";

export default function useRegionGesture({ videoEl, onChange, onCommit, enabled = true }) {
  const sessionRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const [active, setActive] = useState(false);

  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;

  const endSession = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    setActive(false);
    if (s.lastRegion) onCommitRef.current?.(s.lastRegion);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      const s = sessionRef.current;
      if (!s) return;
      const clientX = e.clientX;
      const clientY = e.clientY;
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      const { dx, dy } = pointerDeltaToNorm(s.startPointer, { clientX, clientY }, s.contentPx);
      const next =
        s.mode === "move"
          ? applyMove(s.startRegion, dx, dy)
          : applyResize(s.startRegion, s.handle, dx, dy);
      if (!next) return;
      s.lastRegion = next;
      if (s.raf != null) return;
      s.raf = requestAnimationFrame(() => {
        s.raf = null;
        if (s.lastRegion) onChangeRef.current?.(s.lastRegion);
      });
    };
    const onUp = () => {
      const s = sessionRef.current;
      if (s?.raf != null) {
        cancelAnimationFrame(s.raf);
        s.raf = null;
        if (s.lastRegion) onChangeRef.current?.(s.lastRegion);
      }
      endSession();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [endSession]);

  const beginSession = useCallback(
    (e, region, mode, handle) => {
      if (!enabled || !region) return false;
      // Pointer Events: touch/pen often report button 0 on down.
      if (typeof e.button === "number" && e.button !== 0) return false;

      const video = videoEl?.current;
      let contentPx = getContentPx(video);
      if (!contentPx && video) {
        const br = video.getBoundingClientRect();
        if (br.width > 0 && br.height > 0) {
          contentPx = { width: br.width, height: br.height };
        }
      }
      if (!contentPx) return false;

      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      } catch {}
      if (video && !video.paused) video.pause();

      sessionRef.current = {
        mode,
        handle: handle ?? null,
        startPointer: { clientX: e.clientX, clientY: e.clientY },
        startRegion: { ...region },
        contentPx,
        lastRegion: { ...region },
      };
      setActive(true);
      return true;
    },
    [enabled, videoEl],
  );

  const beginMove = useCallback(
    (e, region) => beginSession(e, region, "move", null),
    [beginSession],
  );

  const beginResize = useCallback(
    (e, region, handle) => beginSession(e, region, "resize", handle),
    [beginSession],
  );

  return { active, beginMove, beginResize };
}
