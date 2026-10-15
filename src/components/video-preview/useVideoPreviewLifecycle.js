import { useEffect, useRef, useState } from "react";
import useEditorStore from "../../stores/useEditorStore";
import { activeOpsBitmask, resolvedDuration } from "./utils";
import { normalizeTiming } from "../../../shared/clip-timeline.js";

export default function useVideoPreviewLifecycle({ videoRef, sel, sidebarMode }) {
  const [, setTimeEpoch] = useState(0);
  const currentTimeRef = useRef(0);
  const activeOpsKeyRef = useRef("");
  const [duration, setDuration] = useState(0);
  const [videoError, setVideoError] = useState(null);
  const [, setLayoutTick] = useState(0);
  const sourcePath = sel?.path;
  const sourceDuration = sel?.duration;
  const trimStart = Math.max(0, Math.min(duration, sel?.trimStart ?? 0));
  const trimEnd = Math.max(trimStart, Math.min(duration, sel?.trimEnd ?? duration));
  const rate = normalizeTiming(sel?.timing).rate;
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = rate;
      video.preservesPitch = true;
    }
  }, [videoRef, sourcePath, rate]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(v);
    return () => ro.disconnect();
  }, [videoRef, sourcePath]);

  useEffect(() => {
    if (!sourcePath) {
      useEditorStore.getState().setCurrentRegion(null);
    }
  }, [sourcePath]);

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
    const onLoadedMeta = () => setDuration(resolvedDuration(v, sourceDuration));
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
  }, [videoRef, sourcePath, sourceDuration, sidebarMode, duration, trimEnd]);

  useEffect(() => {
    const onCommand = (e) => {
      const v = videoRef.current;
      if (!v) return;
      const { type, delta, value } = e.detail || {};
      const st = useEditorStore.getState();
      const item = st.queue[st.selectedIdx];
      const d = resolvedDuration(v, item?.duration ?? sourceDuration);
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
  }, [videoRef, sourcePath, sourceDuration]);

  useEffect(() => {
    currentTimeRef.current = 0;
    activeOpsKeyRef.current = "";
    setTimeEpoch((e) => e + 1);
    setVideoError(null);
  }, [sourcePath]);

  useEffect(() => {
    setDuration(sourceDuration || 0);
  }, [sourcePath, sourceDuration]);

  const videoHandlers = {
    onLoadedMetadata: () => {
      useEditorStore.getState().setCurrentRegion(null);
      setDuration(resolvedDuration(videoRef.current, sourceDuration));
      setVideoError(null);
    },
    onError: () => {
      const code = videoRef.current?.error?.code;
      const message = videoRef.current?.error?.message;
      setVideoError(message ? `${code ? `code ${code}: ` : ""}${message}` : `code ${code || "?"}`);
    },
  };

  return {
    currentTimeRef,
    duration,
    trimStart,
    trimEnd,
    videoError,
    videoHandlers,
  };
}
