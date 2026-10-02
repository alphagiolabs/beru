import { useCallback, useRef, useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";
import { toVideoCoordsNormalized, drawRegionOnCanvas, contentRect } from "../utils/video-utils";
import { applyMove, applyResizeRaw, cursorForHandle } from "../utils/region-interaction";

const HANDLE_THRESHOLD_PX = 16;
const MOVE_INSET_PX = 4;

export default function useCanvas(videoEl, videoKey) {
  const currentRegion = useEditorStore((s) => s.currentRegion);
  const activeTool = useEditorStore((s) => s.activeTool);
  const sidebarMode = useEditorStore((s) => s.sidebarMode);
  const setCurrentRegion = useEditorStore((s) => s.setCurrentRegion);
  const get = useEditorStore.getState;
  const canvasOwnsSelection = activeTool !== "text" && sidebarMode !== "batch";
  const canvasRef = useRef(null);
  const drawStart = useRef({ x: 0, y: 0 });
  const isDrawing = useRef(false);
  const resizeInfo = useRef(null);
  const moveInfo = useRef(null);
  const pendingMoveRef = useRef(null);
  const moveRafRef = useRef(null);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoEl?.current;
    if (!canvas || !video) return;
    const { currentRegion: cr, activeTool: at, sidebarMode: sm } = get();
    const paintTool = sm === "batch" ? "text" : at;
    const regionReady = cr && Math.abs(cr.w) >= 0.01 && Math.abs(cr.h) >= 0.01;
    const domChromeActive = regionReady && (sm === "batch" || at === "text");
    if (domChromeActive) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawRegionOnCanvas(canvas, video, cr, paintTool);
  }, [videoEl, get]);

  useEffect(() => {
    const video = videoEl?.current;
    if (!video || !canvasRef.current) return;
    const ro = new ResizeObserver(() => redrawCanvas());
    ro.observe(video);
    redrawCanvas();
    return () => ro.disconnect();
  }, [videoEl, videoKey, redrawCanvas]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas, currentRegion, activeTool, sidebarMode]);

  const getScreenRect = useCallback(() => {
    const r = currentRegion;
    const video = videoEl?.current;
    if (!r || !video || !video.videoWidth || !video.videoHeight) return null;
    const c = contentRect(video);
    if (!c) return null;
    const sx = c.dw / video.videoWidth;
    const sy = c.dh / video.videoHeight;
    const rx = r.x * video.videoWidth * sx + c.ox + c.br.left;
    const ry = r.y * video.videoHeight * sy + c.oy + c.br.top;
    const rw = r.w * video.videoWidth * sx;
    const rh = r.h * video.videoHeight * sy;
    return { rx, ry, rw, rh };
  }, [currentRegion, videoEl]);

  const hitTestHandle = useCallback(
    (cx, cy) => {
      const sr = getScreenRect();
      if (!sr) return null;
      const { rx, ry, rw, rh } = sr;
      const T = HANDLE_THRESHOLD_PX;
      const handles = {
        tl: [rx, ry],
        tc: [rx + rw / 2, ry],
        tr: [rx + rw, ry],
        ml: [rx, ry + rh / 2],
        mr: [rx + rw, ry + rh / 2],
        bl: [rx, ry + rh],
        bc: [rx + rw / 2, ry + rh],
        br: [rx + rw, ry + rh],
      };
      for (const [name, [hx, hy]] of Object.entries(handles)) {
        if (Math.abs(cx - hx) < T && Math.abs(cy - hy) < T) return name;
      }
      return null;
    },
    [getScreenRect],
  );

  const hitTestRegion = useCallback(
    (cx, cy) => {
      const sr = getScreenRect();
      if (!sr) return false;
      const { rx, ry, rw, rh } = sr;
      return (
        cx > rx + MOVE_INSET_PX &&
        cx < rx + rw - MOVE_INSET_PX &&
        cy > ry + MOVE_INSET_PX &&
        cy < ry + rh - MOVE_INSET_PX
      );
    },
    [getScreenRect],
  );

  const endGesture = useCallback(() => {
    isDrawing.current = false;
    resizeInfo.current = null;
    moveInfo.current = null;
  }, []);

  const applyPointerMove = useCallback(
    (e) => {
      const video = videoEl?.current;
      if (!video) return;

      if (resizeInfo.current) {
        const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
        if (!v) return;
        const next = applyResizeRaw(
          resizeInfo.current.startR,
          resizeInfo.current.handle,
          v.x - resizeInfo.current.startNx,
          v.y - resizeInfo.current.startNy,
        );
        if (next) setCurrentRegion(next);
        return;
      }

      if (moveInfo.current) {
        const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
        if (!v) return;
        const next = applyMove(
          moveInfo.current.startR,
          v.x - moveInfo.current.startNx,
          v.y - moveInfo.current.startNy,
        );
        if (next) setCurrentRegion(next);
        return;
      }

      if (isDrawing.current) {
        const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
        if (!v) return;
        setCurrentRegion({
          x: Math.min(drawStart.current.x, v.x),
          y: Math.min(drawStart.current.y, v.y),
          w: Math.abs(v.x - drawStart.current.x),
          h: Math.abs(v.y - drawStart.current.y),
        });
      }
    },
    [videoEl, setCurrentRegion],
  );

  const flushPendingMove = useCallback(() => {
    moveRafRef.current = null;
    const pt = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (pt) applyPointerMove(pt);
  }, [applyPointerMove]);

  const onMouseUp = useCallback(() => {
    if (moveRafRef.current != null) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    flushPendingMove();
    endGesture();
  }, [flushPendingMove, endGesture]);

  useEffect(() => {
    const onMove = (e) => {
      if (!isDrawing.current && !resizeInfo.current && !moveInfo.current) return;
      pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (moveRafRef.current != null) return;
      moveRafRef.current = requestAnimationFrame(flushPendingMove);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (moveRafRef.current != null) cancelAnimationFrame(moveRafRef.current);
    };
  }, [flushPendingMove, onMouseUp]);

  const onMouseDown = useCallback(
    (e) => {
      const video = videoEl?.current;
      if (!video) return;
      if (activeTool === "pan") return;
      if (e.button !== 0) return;
      if (!video.paused) video.pause();

      if (currentRegion && canvasOwnsSelection) {
        const handle = hitTestHandle(e.clientX, e.clientY);
        if (handle) {
          const startV = toVideoCoordsNormalized(video, e.clientX, e.clientY);
          if (!startV) return;
          resizeInfo.current = {
            handle,
            startNx: startV.x,
            startNy: startV.y,
            startR: { ...currentRegion },
          };
          return;
        }
        if (hitTestRegion(e.clientX, e.clientY)) {
          const startV = toVideoCoordsNormalized(video, e.clientX, e.clientY);
          if (!startV) return;
          moveInfo.current = { startNx: startV.x, startNy: startV.y, startR: { ...currentRegion } };
          return;
        }
      }

      const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
      if (!v) return;
      drawStart.current = { x: v.x, y: v.y };
      isDrawing.current = true;
      setCurrentRegion({ x: v.x, y: v.y, w: 0, h: 0 });
    },
    [
      videoEl,
      activeTool,
      currentRegion,
      setCurrentRegion,
      hitTestHandle,
      hitTestRegion,
      canvasOwnsSelection,
    ],
  );

  const onMouseMove = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (activeTool === "pan") {
        canvas.style.cursor = "grab";
        return;
      }
      if (resizeInfo.current) {
        canvas.style.cursor = cursorForHandle(resizeInfo.current.handle);
      } else if (moveInfo.current || isDrawing.current) {
        canvas.style.cursor = isDrawing.current ? "crosshair" : "grabbing";
      } else if (canvasOwnsSelection) {
        const handle = hitTestHandle(e.clientX, e.clientY);
        if (handle) {
          canvas.style.cursor = cursorForHandle(handle);
        } else if (currentRegion && hitTestRegion(e.clientX, e.clientY)) {
          canvas.style.cursor = "grab";
        } else {
          canvas.style.cursor = "crosshair";
        }
      } else {
        canvas.style.cursor = "crosshair";
      }
    },
    [activeTool, currentRegion, hitTestHandle, hitTestRegion, canvasOwnsSelection],
  );

  return { canvasRef, onMouseDown, onMouseMove, onMouseUp };
}
