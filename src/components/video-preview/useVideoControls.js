import { useCallback, useEffect, useRef, useState } from "react";
import { resolvedDuration } from "./utils";

export default function useVideoControls(
  videoRef,
  { duration = 0, bounds = null, videoKey = null } = {},
) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const seekingRef = useRef(false);
  seekingRef.current = seeking;
  const scrubRafRef = useRef(0);
  const pendingScrubRef = useRef(-1);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;
    const sync = () => {
      setPlaying(!v.paused && !v.ended);
      setMuted(v.muted);
      if (!seekingRef.current) setCurrentTime(v.currentTime);
    };
    const onSeeked = () => setCurrentTime(v.currentTime);
    const syncEvents = ["play", "pause", "ended", "loadedmetadata", "volumechange", "timeupdate"];
    for (const event of syncEvents) v.addEventListener(event, sync);
    v.addEventListener("seeked", onSeeked);
    sync();
    return () => {
      for (const event of syncEvents) v.removeEventListener(event, sync);
      v.removeEventListener("seeked", onSeeked);
    };
  }, [videoRef, videoKey]);

  const seekTo = useCallback(
    (fraction) => {
      const v = videoRef?.current;
      const d = resolvedDuration(v, durationRef.current);
      if (v && d > 0) v.currentTime = Math.max(0, Math.min(d, fraction * d));
    },
    [videoRef],
  );

  const flushScrub = useCallback(() => {
    scrubRafRef.current = 0;
    const frac = pendingScrubRef.current;
    pendingScrubRef.current = -1;
    if (frac < 0 || durationRef.current <= 0) return;
    setCurrentTime(frac * durationRef.current);
    seekTo(frac);
  }, [seekTo]);

  useEffect(
    () => () => {
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current);
    },
    [],
  );

  const startScrub = useCallback(() => setSeeking(true), []);
  const scrubTo = useCallback(
    (frac) => {
      pendingScrubRef.current = frac;
      if (!scrubRafRef.current) scrubRafRef.current = requestAnimationFrame(flushScrub);
    },
    [flushScrub],
  );
  const endScrub = useCallback(() => {
    if (scrubRafRef.current) {
      cancelAnimationFrame(scrubRafRef.current);
      flushScrub();
    }
    setSeeking(false);
  }, [flushScrub]);

  const togglePlay = useCallback(() => {
    const v = videoRef?.current;
    if (!v) return;
    const b = boundsRef.current;
    if (v.paused) {
      if (b && (v.currentTime < b.start || v.currentTime >= b.end)) v.currentTime = b.start;
      v.play();
    } else v.pause();
  }, [videoRef]);

  const jumpStart = useCallback(() => {
    const v = videoRef?.current;
    if (v) v.currentTime = boundsRef.current?.start ?? 0;
  }, [videoRef]);

  const jumpEnd = useCallback(() => {
    const v = videoRef?.current;
    const d = resolvedDuration(v, durationRef.current);
    if (v && d) v.currentTime = boundsRef.current?.end ?? d;
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const v = videoRef?.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, [videoRef]);

  const seekFrac = duration > 0 ? currentTime / duration : 0;

  return {
    playing,
    currentTime,
    muted,
    seeking,
    seekFrac,
    seekTo,
    togglePlay,
    jumpStart,
    jumpEnd,
    toggleMute,
    startScrub,
    scrubTo,
    endScrub,
  };
}
