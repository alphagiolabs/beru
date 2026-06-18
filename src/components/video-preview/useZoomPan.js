import { useRef, useEffect, useState, useCallback } from "react";
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from "./utils";

/**
 * Encapsulates zoom & pan state, refs, callbacks, and effects for VideoPreview.
 *
 * Uses a dual state+ref pattern (zoom/zoomRef, pan/panRef) to avoid stale
 * closures in native window event handlers (pan drag, wheel zoom).
 *
 * @param {React.RefObject<HTMLVideoElement>} videoRef - shared video element ref
 * @param {boolean} isSplitCompare - whether split-compare mode is active
 *   (zoom is disabled and reset to fit while true)
 * @param {{ panToolActive?: boolean }} options
 * @returns {{
 *   outerRef, wrapperRef, zoom, pan, isPanning,
 *   zoomIn, zoomOut, zoomReset, onPanMouseDown,
 *   isSplitCompareRef, setZoomBoth, setPanBoth,
 * }}
 */
export default function useZoomPan(videoRef, isSplitCompare, { panToolActive = false } = {}) {
  /* Zoom & pan refs (avoid stale closures in native event handlers) */
  const outerRef = useRef(null);
  const wrapperRef = useRef(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const panDragRef = useRef(null);
  const isSplitCompareRef = useRef(false);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const setZoomBoth = useCallback((z) => {
    zoomRef.current = z;
    setZoom(z);
  }, []);
  const setPanBoth = useCallback((p) => {
    panRef.current = p;
    setPan(p);
  }, []);

  const clampPan = useCallback((px, py, z) => {
    const v = videoRef.current;
    const outer = outerRef.current;
    if (!v || !outer || z <= 1) return { x: 0, y: 0 };
    const baseW = v.offsetWidth || 1;
    const baseH = v.offsetHeight || 1;
    const maxPanX = Math.max(0, (baseW * z - outer.clientWidth) / 2);
    const maxPanY = Math.max(0, (baseH * z - outer.clientHeight) / 2);
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, px)),
      y: Math.max(-maxPanY, Math.min(maxPanY, py)),
    };
  }, []);

  /* Zoom while keeping the given screen point (or the wrapper center) stable. */
  const applyZoom = useCallback(
    (nextZ, screenPoint) => {
      if (isSplitCompareRef.current) return;
      const v = videoRef.current;
      const w = wrapperRef.current;
      const outer = outerRef.current;
      if (!v || !w || !outer) return;
      const z0 = zoomRef.current;
      const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZ));
      if (z1 === z0) return;
      const baseW = v.offsetWidth || w.offsetWidth || 1;
      const baseH = v.offsetHeight || w.offsetHeight || 1;
      const wr = w.getBoundingClientRect(); // includes current pan
      const sx = screenPoint ? screenPoint.x : wr.left + baseW / 2;
      const sy = screenPoint ? screenPoint.y : wr.top + baseH / 2;
      const relX = sx - wr.left;
      const relY = sy - wr.top;
      const panX = panRef.current.x + relX * (1 - z1 / z0);
      const panY = panRef.current.y + relY * (1 - z1 / z0);
      const clamped = clampPan(panX, panY, z1);
      setZoomBoth(z1);
      setPanBoth(clamped);
    },
    [clampPan, setZoomBoth, setPanBoth],
  );

  const zoomIn = useCallback(() => applyZoom(zoomRef.current + ZOOM_STEP), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(zoomRef.current - ZOOM_STEP), [applyZoom]);
  const zoomReset = useCallback(() => {
    setZoomBoth(1);
    setPanBoth({ x: 0, y: 0 });
  }, [setZoomBoth, setPanBoth]);

  /* Pan with middle-mouse drag, or primary drag while the explicit hand tool is active. */
  const onPanMouseDown = useCallback(
    (e) => {
      const primaryPan = panToolActive && e.button === 0;
      const middlePan = e.button === 1;
      if (!primaryPan && !middlePan) return;
      if (zoomRef.current <= 1) return;
      e.preventDefault();
      setIsPanning(true);
      panDragRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
    },
    [panToolActive],
  );

  const onPanMouseMove = useCallback(
    (e) => {
      const d = panDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      const clamped = clampPan(d.panX + dx, d.panY + dy, zoomRef.current);
      setPanBoth(clamped);
    },
    [clampPan, setPanBoth],
  );

  const onPanMouseUp = useCallback(() => {
    if (panDragRef.current) {
      panDragRef.current = null;
      setIsPanning(false);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onPanMouseMove);
    window.addEventListener("mouseup", onPanMouseUp);
    return () => {
      window.removeEventListener("mousemove", onPanMouseMove);
      window.removeEventListener("mouseup", onPanMouseUp);
    };
  }, [onPanMouseMove, onPanMouseUp]);

  /* Ctrl + wheel zooms toward the cursor. */
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      applyZoom(zoomRef.current * factor, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [applyZoom]);

  /* Zoom is disabled in split-compare mode (reset to fit). */
  useEffect(() => {
    if (isSplitCompare) {
      setZoomBoth(1);
      setPanBoth({ x: 0, y: 0 });
    }
  }, [isSplitCompare, setZoomBoth, setPanBoth]);

  return {
    outerRef,
    wrapperRef,
    zoom,
    pan,
    isPanning,
    zoomIn,
    zoomOut,
    zoomReset,
    onPanMouseDown,
    isSplitCompareRef,
    setZoomBoth,
    setPanBoth,
  };
}
