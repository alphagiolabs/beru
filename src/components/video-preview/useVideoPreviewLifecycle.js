import { useEffect, useRef, useState } from "react";
import useEditorStore from "../../stores/useEditorStore";
import { activeOpsBitmask, resolvedDuration } from "./utils";

export default function useVideoPreviewLifecycle({ videoRef, sel, sidebarMode }) {
  const [timeEpoch, setTimeEpoch] = useState(0);
  const currentTimeRef = useRef(0);
  const activeOpsKeyRef = useRef("");
  const [duration, setDuration] = useState(0);
  const [videoError, setVideoError] = useState(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const trimStart = Math.max(0, Math.min(duration, sel?.trimStart ?? 0));
  const trimEnd = Math.max(trimStart, Math.min(duration, sel?.trimEnd ?? duration));

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(v);
    return () => ro.disconnect();
  }, [videoRef, sel?.path]);

  useEffect(() => {
    if (!sel) {
      useEditorStore.getState().setCurrentRegion(null);
    }
  }, [sel?.path]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const syncTime = (t, forceRender) => {
      currentTimeRef.current = t;
      const st = useEditorStore.getState();
      const item =
        st.selectedIdx >= 0 && st.selectedIdx < st.queue.length ? st.queue[st.selectedIdx] : null;
      const key = activeOpsBitmask(item?.operations, t);
      if (forceRender || key !== activeOpsKeyRef.current) {
        activeOpsKeyRef.current = key;
        setTimeEpoch((e) => e + 1);
      }
    };
    const onPause = () => {
      syncTime(v.currentTime, true);
    };
    const onTimeUpdate = () => {
      if (sidebarMode === "logo" && duration > 0 && v.currentTime >= trimEnd && !v.paused) {
        v.pause();
        v.currentTime = trimEnd;
      }
      syncTime(v.currentTime, v.paused);
    };
    const onSeeked = () => syncTime(v.currentTime, true);
    const onLoadedMeta = () => setDuration(resolvedDuration(v, sel?.duration));
    const onEnded = () => {
      syncTime(v.currentTime, true);
    };
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("loadedmetadata", onLoadedMeta);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("loadedmetadata", onLoadedMeta);
      v.removeEventListener("ended", onEnded);
    };
  }, [videoRef, sel?.path, sel?.duration, sidebarMode, duration, trimEnd]);

  useEffect(() => {
    const onCommand = (e) => {
      const v = videoRef.current;
      if (!v) return;
      const { type, delta, value } = e.detail || {};
      const st = useEditorStore.getState();
      const item = st.queue[st.selectedIdx];
      const d = resolvedDuration(v, item?.duration ?? sel?.duration);
      const logo = st.sidebarMode === "logo" && d > 0;
      const tStart = logo ? Math.max(0, Math.min(d, item?.trimStart ?? 0)) : 0;
      const tEnd = logo ? Math.max(tStart, Math.min(d, item?.trimEnd ?? d)) : d;
      if (type === "toggle-play") {
        if (v.paused) {
          if (v.currentTime < tStart || v.currentTime >= tEnd) v.currentTime = tStart;
          v.play();
        } else v.pause();
      } else if (type === "seek" && Number.isFinite(delta)) {
        if (!d) return;
        v.currentTime = Math.max(0, Math.min(d, v.currentTime + delta));
      } else if (type === "seek-abs" && Number.isFinite(value)) {
        if (!d) return;
        v.currentTime =
          value >= 1 ? Math.max(tStart, tEnd - 0.05) : tStart + value * (tEnd - tStart);
      }
    };
    window.addEventListener("beru:video:command", onCommand);
    return () => window.removeEventListener("beru:video:command", onCommand);
  }, [videoRef, sel?.path, sel?.duration]);

  useEffect(() => {
    currentTimeRef.current = 0;
    activeOpsKeyRef.current = "";
    setTimeEpoch((e) => e + 1);
    setDuration(sel?.duration || 0);
    setVideoError(null);
  }, [sel?.path]);

  const videoHandlers = {
    onLoadedMetadata: () => {
      useEditorStore.getState().setCurrentRegion(null);
      setDuration(resolvedDuration(videoRef.current, sel?.duration));
      setVideoError(null);
    },
    onError: () => {
      const code = videoRef.current?.error?.code;
      const message = videoRef.current?.error?.message;
      setVideoError(message ? `${code ? `code ${code}: ` : ""}${message}` : `code ${code || "?"}`);
    },
  };

  return {
    timeEpoch,
    currentTimeRef,
    duration,
    trimStart,
    trimEnd,
    videoError,
    layoutTick,
    videoHandlers,
  };
}
