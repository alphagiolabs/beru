import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyMove,
  applyResize,
  getContentPx,
  pointerDeltaToNorm,
} from "../utils/region-interaction";
import { isInOutputView, videoPointerDelta } from "../utils/video-utils";

export default function useRegionGesture({
  videoEl,
  onChange,
  onCommit,
  enabled = true,
  owner = null,
  input = "pointer",
  moveRegion = applyMove,
  pauseOnStart = true,
}) {
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
    if (s.moved) s.onCommit?.(s.lastRegion);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      const s = sessionRef.current;
      if (!s) return;
      const clientX = e.clientX;
      const clientY = e.clientY;
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      const video = s.video;
      const delta = isInOutputView(video)
        ? videoPointerDelta(video, s.startPointer, { clientX, clientY })
        : pointerDeltaToNorm(s.startPointer, { clientX, clientY }, s.contentPx);
      if (!delta) return;
      const { dx, dy } = delta;
      const next =
        dx === 0 && dy === 0
          ? s.startRegion
          : s.mode === "move"
            ? s.moveRegion(s.startRegion, dx, dy)
            : applyResize(s.startRegion, s.handle, dx, dy);
      if (!next || ["x", "y", "w", "h"].every((key) => next[key] === s.lastRegion[key])) return;
      s.moved = true;
      s.lastRegion = next;
      if (s.raf != null) return;
      s.raf = requestAnimationFrame(() => {
        s.raf = null;
        s.onChange?.(s.lastRegion);
      });
    };
    const onUp = () => {
      const s = sessionRef.current;
      if (s?.raf != null) {
        cancelAnimationFrame(s.raf);
        s.raf = null;
        s.onChange?.(s.lastRegion);
      }
      endSession();
    };
    window.addEventListener(`${input}move`, onMove);
    window.addEventListener(`${input}up`, onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener(`${input}move`, onMove);
      window.removeEventListener(`${input}up`, onUp);
      window.removeEventListener("pointercancel", onUp);
      const s = sessionRef.current;
      if (s?.raf != null) cancelAnimationFrame(s.raf);
      sessionRef.current = null;
    };
  }, [endSession, input, enabled, owner]);

  useEffect(() => setActive(false), [enabled, owner]);

  const beginSession = useCallback(
    (e, region, mode, handle) => {
      if (!enabled || !region) return false;
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
      if (pauseOnStart && video && !video.paused) video.pause();

      if (sessionRef.current?.raf != null) cancelAnimationFrame(sessionRef.current.raf);
      sessionRef.current = {
        video,
        mode,
        moveRegion,
        handle: handle ?? null,
        startPointer: { clientX: e.clientX, clientY: e.clientY },
        startRegion: { ...region },
        contentPx,
        lastRegion: { ...region },
        moved: false,
        onChange: onChangeRef.current,
        onCommit: onCommitRef.current,
      };
      setActive(true);
      return true;
    },
    [enabled, videoEl, moveRegion, pauseOnStart],
  );

  const beginMove = useCallback(
    (e, region) => beginSession(e, region, "move", null),
    [beginSession],
  );

  const beginResize = useCallback(
    (e, region, handle) => beginSession(e, region, "resize", handle),
    [beginSession],
  );

  const nudge = useCallback(
    (region, dxPx, dyPx) => {
      const video = videoEl?.current;
      const width = video?.videoWidth;
      const height = video?.videoHeight;
      if (!enabled || !region || !(width > 0 && height > 0)) return;
      const next = applyMove(region, dxPx / width, dyPx / height);
      if (next && ["x", "y", "w", "h"].some((key) => next[key] !== region[key]))
        onCommitRef.current?.(next);
    },
    [enabled, videoEl],
  );

  return { active, beginMove, beginResize, nudge };
}
