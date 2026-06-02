import { useCallback, useRef, useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";
import { toVideoCoordsNormalized, drawRegionOnCanvas, contentRect, clampRegionToVideo } from "../utils/video-utils";

const HANDLE_THRESHOLD_PX = 16;
const MOVE_INSET_PX = 4;

export default function useCanvas(videoEl) {
  const store = useEditorStore();
  const canvasRef = useRef(null);
  const drawStart = useRef({ x: 0, y: 0 });
  const isDrawing = useRef(false);
  const resizeInfo = useRef(null);
  const moveInfo = useRef(null);

  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoEl?.current;
    if (!canvas || !video) return;
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    drawRegionOnCanvas(canvas, video, store.currentRegion, store.activeTool, store.delogoMethod);
  }, [videoEl, store.currentRegion, store.activeTool, store.delogoMethod]);

  useEffect(() => {
    const video = videoEl?.current;
    if (!video || !canvasRef.current) return;
    const ro = new ResizeObserver(fitCanvas);
    ro.observe(video);
    fitCanvas();
    return () => ro.disconnect();
  }, [videoEl, fitCanvas]);

  const getScreenRect = useCallback(() => {
    const r = store.currentRegion;
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
  }, [store.currentRegion, videoEl]);

  const hitTestHandle = useCallback((cx, cy) => {
    const sr = getScreenRect();
    if (!sr) return null;
    const { rx, ry, rw, rh } = sr;
    const T = HANDLE_THRESHOLD_PX;
    const handles = {
      tl: [rx, ry], tc: [rx + rw / 2, ry], tr: [rx + rw, ry],
      ml: [rx, ry + rh / 2], mr: [rx + rw, ry + rh / 2],
      bl: [rx, ry + rh], bc: [rx + rw / 2, ry + rh], br: [rx + rw, ry + rh],
    };
    for (const [name, [hx, hy]] of Object.entries(handles)) {
      if (Math.abs(cx - hx) < T && Math.abs(cy - hy) < T) return name;
    }
    return null;
  }, [getScreenRect]);

  const hitTestRegion = useCallback((cx, cy) => {
    const sr = getScreenRect();
    if (!sr) return false;
    const { rx, ry, rw, rh } = sr;
    return cx > rx + MOVE_INSET_PX &&
      cx < rx + rw - MOVE_INSET_PX &&
      cy > ry + MOVE_INSET_PX &&
      cy < ry + rh - MOVE_INSET_PX;
  }, [getScreenRect]);

  const cursorForHandle = (h) => {
    const m = { tl: "nwse-resize", tc: "ns-resize", tr: "nesw-resize", ml: "ew-resize", mr: "ew-resize", bl: "nesw-resize", bc: "ns-resize", br: "nwse-resize" };
    return m[h] || "move";
  };

  const onMouseDown = useCallback((e) => {
    const video = videoEl?.current;
    if (!video) return;
    if (!video.paused) video.pause();

    /* Priority: handle > region interior > empty space */
    if (store.currentRegion) {
      const handle = hitTestHandle(e.clientX, e.clientY);
      if (handle) {
        resizeInfo.current = { handle, startNx: 0, startNy: 0, startR: { ...store.currentRegion } };
        return;
      }
      if (hitTestRegion(e.clientX, e.clientY)) {
        const startV = toVideoCoordsNormalized(video, e.clientX, e.clientY);
        if (!startV) return;
        moveInfo.current = { startNx: startV.x, startNy: startV.y, startR: { ...store.currentRegion } };
        return;
      }
    }

    /* No region or click outside: start drawing a new one */
    const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
    if (!v) return;
    drawStart.current = { x: v.x, y: v.y };
    isDrawing.current = true;
    store.setCurrentRegion({ x: v.x, y: v.y, w: 0, h: 0 });
  }, [videoEl, store, hitTestHandle, hitTestRegion]);

  const onMouseMove = useCallback((e) => {
    const video = videoEl?.current;
    if (!video) return;

    if (resizeInfo.current) {
      const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
      if (!v) return;
      const sr = resizeInfo.current.startR;
      if (!resizeInfo.current.startNx) {
        resizeInfo.current.startNx = v.x;
        resizeInfo.current.startNy = v.y;
        return;
      }
      const dx = v.x - resizeInfo.current.startNx;
      const dy = v.y - resizeInfo.current.startNy;
      const h = resizeInfo.current.handle;
      const MIN = 0.01;
      let nx = sr.x, ny = sr.y, nw = sr.w, nh = sr.h;
      if (h.includes("l")) { nx = sr.x + dx; nw = sr.w - dx; }
      if (h.includes("r")) { nw = sr.w + dx; }
      if (h.includes("t") || h === "tc") { ny = sr.y + dy; nh = sr.h - dy; }
      if (h.includes("b") || h === "bc") { nh = sr.h + dy; }
      if (nw < MIN) { nw = MIN; if (h.includes("l")) nx = sr.x + sr.w - MIN; }
      if (nh < MIN) { nh = MIN; if (h.includes("t") || h === "tc") ny = sr.y + sr.h - MIN; }
      store.setCurrentRegion({ x: nx, y: ny, w: nw, h: nh });
    } else if (moveInfo.current) {
      const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
      if (!v) return;
      const sr = moveInfo.current.startR;
      const dx = v.x - moveInfo.current.startNx;
      const dy = v.y - moveInfo.current.startNy;
      store.setCurrentRegion(clampRegionToVideo(
        { x: sr.x + dx, y: sr.y + dy, w: sr.w, h: sr.h },
        1, 1
      ));
    } else if (isDrawing.current) {
      const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
      if (!v) return;
      store.setCurrentRegion({
        x: Math.min(drawStart.current.x, v.x),
        y: Math.min(drawStart.current.y, v.y),
        w: Math.abs(v.x - drawStart.current.x),
        h: Math.abs(v.y - drawStart.current.y),
      });
    }

    /* Update cursor */
    const canvas = canvasRef.current;
    if (canvas) {
      if (resizeInfo.current) {
        canvas.style.cursor = cursorForHandle(resizeInfo.current.handle);
      } else if (moveInfo.current) {
        canvas.style.cursor = "grabbing";
      } else {
        const handle = hitTestHandle(e.clientX, e.clientY);
        if (handle) {
          canvas.style.cursor = cursorForHandle(handle);
        } else if (store.currentRegion && hitTestRegion(e.clientX, e.clientY)) {
          canvas.style.cursor = "grab";
        } else {
          canvas.style.cursor = store.currentRegion ? "crosshair" : "crosshair";
        }
      }
    }
  }, [videoEl, store, hitTestHandle, hitTestRegion]);

  const onMouseUp = useCallback(() => {
    isDrawing.current = false;
    resizeInfo.current = null;
    moveInfo.current = null;
  }, []);

  const onMouseLeave = useCallback(() => {
    /* Keep move state if mouse leaves briefly; clear on full up only */
  }, []);

  return { canvasRef, onMouseDown, onMouseMove, onMouseUp, onMouseLeave };
}
