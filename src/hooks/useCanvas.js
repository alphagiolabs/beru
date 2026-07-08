import { useCallback, useRef, useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";
import {
  toVideoCoordsNormalized,
  drawRegionOnCanvas,
  contentRect,
  clampRegionToVideo,
} from "../utils/video-utils";

const HANDLE_THRESHOLD_PX = 16;
const MOVE_INSET_PX = 4;

export default function useCanvas(videoEl) {
  const currentRegion = useEditorStore((s) => s.currentRegion);
  const activeTool = useEditorStore((s) => s.activeTool);
  const delogoMethod = useEditorStore((s) => s.delogoMethod);
  const sidebarMode = useEditorStore((s) => s.sidebarMode);
  const selectedTemplateRegionId = useEditorStore((s) => s.selectedTemplateRegionId);
  const setCurrentRegion = useEditorStore((s) => s.setCurrentRegion);
  const get = useEditorStore.getState;
  // Text move/resize is owned by TextRegionFrame (DOM). Canvas only draws
  // new regions in those modes and never hit-tests the selection chrome.
  const canvasOwnsSelection = activeTool !== "text" && sidebarMode !== "batch";
  const canvasRef = useRef(null);
  const drawStart = useRef({ x: 0, y: 0 });
  const isDrawing = useRef(false);
  const resizeInfo = useRef(null);
  const moveInfo = useRef(null);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoEl?.current;
    if (!canvas || !video) return;
    const w = video.offsetWidth;
    const h = video.offsetHeight;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }, [videoEl]);

  // Stable identity: read the live region/tool/method from the store on each
  // call instead of closing over them. Otherwise currentRegion changes on every
  // mousemove while drawing, producing a new redrawCanvas identity and causing
  // the ResizeObserver effect below to disconnect/recreate the observer per move.
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoEl?.current;
    if (!canvas || !video) return;
    const { currentRegion: cr, activeTool: at, delogoMethod: dm, sidebarMode: sm } = get();
    // Batch text uses tool="text" for a dashed outline (no fill) so the live
    // TextOverlay is not covered by a translucent canvas rect.
    const paintTool = sm === "batch" ? "text" : at;
    // When DOM TextRegionFrame owns the selection, clear canvas chrome so handles
    // are not double-drawn and do not steal the interaction model.
    const regionReady = cr && Math.abs(cr.w) >= 0.01 && Math.abs(cr.h) >= 0.01;
    const domChromeActive = regionReady && (sm === "batch" || at === "text");
    if (domChromeActive) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawRegionOnCanvas(canvas, video, cr, paintTool, dm);
  }, [videoEl, get]);

  useEffect(() => {
    const video = videoEl?.current;
    if (!video || !canvasRef.current) return;
    const ro = new ResizeObserver(() => {
      resizeCanvas();
      redrawCanvas();
    });
    ro.observe(video);
    resizeCanvas();
    redrawCanvas();
    return () => ro.disconnect();
  }, [videoEl, resizeCanvas, redrawCanvas]);

  // Redraw when the region/tool/method change. redrawCanvas itself is now stable,
  // so without these deps the canvas would never refresh on region edits.
  useEffect(() => {
    redrawCanvas();
  }, [
    redrawCanvas,
    currentRegion,
    activeTool,
    delogoMethod,
    sidebarMode,
    selectedTemplateRegionId,
  ]);

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

  const cursorForHandle = (h) => {
    const m = {
      tl: "nwse-resize",
      tc: "ns-resize",
      tr: "nesw-resize",
      ml: "ew-resize",
      mr: "ew-resize",
      bl: "nesw-resize",
      bc: "ns-resize",
      br: "nwse-resize",
    };
    return m[h] || "move";
  };

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
        const sr = resizeInfo.current.startR;
        const dx = v.x - resizeInfo.current.startNx;
        const dy = v.y - resizeInfo.current.startNy;
        const h = resizeInfo.current.handle;
        const MIN = 0.01;
        let nx = sr.x,
          ny = sr.y,
          nw = sr.w,
          nh = sr.h;
        if (h.includes("l")) {
          nx = sr.x + dx;
          nw = sr.w - dx;
        }
        if (h.includes("r")) {
          nw = sr.w + dx;
        }
        if (h.includes("t") || h === "tc") {
          ny = sr.y + dy;
          nh = sr.h - dy;
        }
        if (h.includes("b") || h === "bc") {
          nh = sr.h + dy;
        }
        if (nw < MIN) {
          nw = MIN;
          if (h.includes("l")) nx = sr.x + sr.w - MIN;
        }
        if (nh < MIN) {
          nh = MIN;
          if (h.includes("t") || h === "tc") ny = sr.y + sr.h - MIN;
        }
        setCurrentRegion({ x: nx, y: ny, w: nw, h: nh });
        return;
      }

      if (moveInfo.current) {
        const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
        if (!v) return;
        const sr = moveInfo.current.startR;
        const dx = v.x - moveInfo.current.startNx;
        const dy = v.y - moveInfo.current.startNy;
        setCurrentRegion(
          clampRegionToVideo({ x: sr.x + dx, y: sr.y + dy, w: sr.w, h: sr.h }, 1, 1),
        );
        return;
      }

      if (isDrawing.current) {
        const v = toVideoCoordsNormalized(video, e.clientX, e.clientY);
        if (!v) return;
        // Live draw must not fan out through batch template updates — only touch
        // currentRegion until mouseup (setCurrentRegion still OK when no template selected).
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

  // Window-level move/up so rubber-band drawing is not cancelled when the cursor
  // leaves the canvas (onMouseLeave previously aborted mid-draw).
  useEffect(() => {
    const onMove = (e) => {
      if (!isDrawing.current && !resizeInfo.current && !moveInfo.current) return;
      applyPointerMove(e);
    };
    const onUp = () => endGesture();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [applyPointerMove, endGesture]);

  const onMouseDown = useCallback(
    (e) => {
      const video = videoEl?.current;
      if (!video) return;
      if (activeTool === "pan") return;
      /* Only the primary button draws/resizes regions; middle button is
       * reserved for zoom-pan (see VideoPreview). */
      if (e.button !== 0) return;
      if (!video.paused) video.pause();

      /* Priority: handle > region interior > empty space (non-text tools only) */
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

      /* No region or click outside: start drawing a new one */
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
      /* Cursor feedback only — gestures run on window listeners above. */
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

  const onMouseUp = endGesture;

  return { canvasRef, onMouseDown, onMouseMove, onMouseUp };
}
