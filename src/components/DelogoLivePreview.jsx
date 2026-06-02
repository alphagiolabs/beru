import { useEffect, useRef } from "react";
import useEditorStore from "../stores/useEditorStore";
import { regionToScreen } from "../utils/video-utils";

/* ── Cached offscreen canvases (one per size class, reused per frame) ─── */

const sourceCache = { canvas: null, ctx: null };
const tinyCache = { canvas: null, ctx: null };

function getSourceCanvas(w, h) {
  if (!sourceCache.canvas) {
    sourceCache.canvas = document.createElement("canvas");
    sourceCache.ctx = sourceCache.canvas.getContext("2d", { willReadFrequently: true });
  }
  const c = sourceCache.canvas;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

function getTinyCanvas(w, h) {
  if (!tinyCache.canvas) {
    tinyCache.canvas = document.createElement("canvas");
    tinyCache.ctx = tinyCache.canvas.getContext("2d");
  }
  const c = tinyCache.canvas;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/* ── Region → source pixels in video coordinate space ─────────────────── */

function sourceRect(region, video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  return {
    sx: Math.max(0, Math.floor(region.x * vw)),
    sy: Math.max(0, Math.floor(region.y * vh)),
    sw: Math.max(1, Math.min(vw, Math.floor(region.w * vw))),
    sh: Math.max(1, Math.min(vh, Math.floor(region.h * vh))),
  };
}

/* ── Effect renderers (draw into the provided 2D context at screen size) ─ */

function renderMosaic(ctx, video, region, screen, blockSize) {
  const { sx, sy, sw, sh } = sourceRect(region, video);
  const src = getSourceCanvas(sw, sh);
  const sctx = sourceCache.ctx;
  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const data = sctx.getImageData(0, 0, sw, sh).data;

  const cols = Math.max(1, Math.ceil(sw / blockSize));
  const rows = Math.max(1, Math.ceil(sh / blockSize));
  const tiny = getTinyCanvas(cols, rows);
  const tctx = tinyCache.ctx;
  const tinyData = tctx.createImageData(cols, rows);
  const tData = tinyData.data;

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * blockSize;
      const y0 = by * blockSize;
      const x1 = Math.min(x0 + blockSize, sw);
      const y1 = Math.min(y0 + blockSize, sh);
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * sw + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
      const i = (by * cols + bx) * 4;
      tData[i] = Math.round(r / n);
      tData[i + 1] = Math.round(g / n);
      tData[i + 2] = Math.round(b / n);
      tData[i + 3] = 255;
    }
  }
  tctx.putImageData(tinyData, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, screen.w, screen.h);
  ctx.drawImage(tiny, 0, 0, cols, rows, 0, 0, screen.w, screen.h);
  ctx.restore();
}

function mirrorSampleRect(sx, sy, sw, sh, vw, vh, side) {
  const s = (side || "right").toLowerCase();
  if (s === "right") {
    if (sx + sw + sw <= vw) return { srcX: sx + sw, srcY: sy, cw: sw, ch: sh, flipX: true };
    if (sx >= sw) return { srcX: sx - sw, srcY: sy, cw: sw, ch: sh, flipX: true };
    const cw = Math.max(1, Math.min(sw, vw - (sx + sw)));
    return { srcX: Math.max(0, sx + sw), srcY: sy, cw, ch: sh, flipX: true, scale: true };
  }
  if (s === "left") {
    if (sx >= sw) return { srcX: sx - sw, srcY: sy, cw: sw, ch: sh, flipX: true };
    if (sx + sw + sw <= vw) return { srcX: sx + sw, srcY: sy, cw: sw, ch: sh, flipX: true };
    const cw = Math.max(1, Math.min(sw, sx));
    return { srcX: Math.max(0, sx - cw), srcY: sy, cw, ch: sh, flipX: true, scale: true };
  }
  if (s === "bottom") {
    if (sy + sh + sh <= vh) return { srcX: sx, srcY: sy + sh, cw: sw, ch: sh, flipX: false };
    if (sy >= sh) return { srcX: sx, srcY: sy - sh, cw: sw, ch: sh, flipX: false };
    const ch = Math.max(1, Math.min(sh, vh - (sy + sh)));
    return { srcX: sx, srcY: Math.max(0, sy + sh), cw: sw, ch, flipX: false, scale: true };
  }
  if (sy >= sh) return { srcX: sx, srcY: sy - sh, cw: sw, ch: sh, flipX: false };
  if (sy + sh + sh <= vh) return { srcX: sx, srcY: sy + sh, cw: sw, ch: sh, flipX: false };
  const ch = Math.max(1, Math.min(sh, sy));
  return { srcX: sx, srcY: Math.max(0, sy - ch), cw: sw, ch, flipX: false, scale: true };
}

function renderMirror(ctx, video, region, screen, side) {
  const { sx, sy, sw, sh } = sourceRect(region, video);
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sample = mirrorSampleRect(sx, sy, sw, sh, vw, vh, side);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, screen.w, screen.h);
  if (sample.flipX) {
    ctx.translate(screen.w, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, screen.h);
    ctx.scale(1, -1);
  }
  ctx.drawImage(
    video,
    sample.srcX, sample.srcY, sample.cw, sample.ch,
    0, 0, screen.w, screen.h,
  );
  ctx.restore();
}

function renderInpaint(ctx, video, region, screen) {
  const { sx, sy, sw, sh } = sourceRect(region, video);
  const src = getSourceCanvas(sw, sh);
  const sctx = sourceCache.ctx;
  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const sData = sctx.getImageData(0, 0, sw, sh).data;

  const out = sctx.createImageData(sw, sh);
  const dData = out.data;
  const lastRow = (sh - 1) * sw;
  const lastCol = sw - 1;

  for (let y = 0; y < sh; y++) {
    const rowOff = y * sw;
    for (let x = 0; x < sw; x++) {
      const ti = x * 4;
      const bi = (lastRow + x) * 4;
      const li = rowOff * 4;
      const ri = (rowOff + lastCol) * 4;
      const wt = 1 / (y + 1);
      const wb = 1 / (sh - y);
      const wl = 1 / (x + 1);
      const wr = 1 / (sw - x);
      const total = wt + wb + wl + wr;
      const di = (rowOff + x) * 4;
      dData[di]     = (sData[ti]     * wt + sData[bi]     * wb + sData[li]     * wl + sData[ri]     * wr) / total;
      dData[di + 1] = (sData[ti + 1] * wt + sData[bi + 1] * wb + sData[li + 1] * wl + sData[ri + 1] * wr) / total;
      dData[di + 2] = (sData[ti + 2] * wt + sData[bi + 2] * wb + sData[li + 2] * wl + sData[ri + 2] * wr) / total;
      dData[di + 3] = 255;
    }
  }

  sctx.putImageData(out, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, screen.w, screen.h);
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, screen.w, screen.h);
  ctx.restore();
}

const temporalFrameBuffer = { frames: [], max: 7 };

function medianChannel(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function renderTemporal(ctx, video, region, screen, radius) {
  const { sx, sy, sw, sh } = sourceRect(region, video);
  const src = getSourceCanvas(sw, sh);
  const sctx = sourceCache.ctx;
  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const frame = sctx.getImageData(0, 0, sw, sh);

  const maxFrames = Math.max(3, Math.min(15, radius * 2 + 1));
  temporalFrameBuffer.max = maxFrames;
  temporalFrameBuffer.frames.push(frame);
  if (temporalFrameBuffer.frames.length > maxFrames) {
    temporalFrameBuffer.frames.shift();
  }

  const out = sctx.createImageData(sw, sh);
  const d = out.data;
  const buffers = temporalFrameBuffer.frames;
  const n = buffers.length;

  for (let i = 0; i < sw * sh; i++) {
    const o = i * 4;
    const rs = [], gs = [], bs = [];
    for (let f = 0; f < n; f++) {
      const fd = buffers[f].data;
      rs.push(fd[o]);
      gs.push(fd[o + 1]);
      bs.push(fd[o + 2]);
    }
    d[o] = medianChannel(rs);
    d[o + 1] = medianChannel(gs);
    d[o + 2] = medianChannel(bs);
    d[o + 3] = 255;
  }
  sctx.putImageData(out, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, screen.w, screen.h);
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, screen.w, screen.h);
  ctx.restore();
}

/* ── Component ────────────────────────────────────────────────────────── */

const CANVAS_METHODS = new Set(["temporal", "mirror", "mosaic", "inpaint"]);

export default function DelogoLivePreview({ videoRef }) {
  const store = useEditorStore();
  const canvasRef = useRef(null);
  const labelRef = useRef(null);
  const cssRef = useRef(null);

  const { currentRegion, activeTool, sidebarMode, delogoMethod } = store;
  const visible = !!(sidebarMode === "logo" && activeTool === "delogo" && currentRegion);
  const isCanvas = visible && CANVAS_METHODS.has(delogoMethod);

  /* Reset temporal buffer when region or method changes */
  useEffect(() => {
    temporalFrameBuffer.frames = [];
  }, [currentRegion, delogoMethod]);

  /* Canvas path — re-draws every frame while visible */
  useEffect(() => {
    if (!isCanvas) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    const draw = () => {
      const video = videoRef.current;
      const region = useEditorStore.getState().currentRegion;
      const method = useEditorStore.getState().delogoMethod;
      const pausedOrHidden =
        document.hidden ||
        !video ||
        video.paused ||
        !region ||
        video.readyState < 2;
      if (pausedOrHidden) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      const screen = regionToScreen(region, video);
      if (!screen || screen.w < 1 || screen.h < 1) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const w = Math.max(1, Math.round(screen.w));
      const h = Math.max(1, Math.round(screen.h));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      canvas.style.left = screen.x + "px";
      canvas.style.top = screen.y + "px";
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";

      const ctx = canvas.getContext("2d");
      const s = useEditorStore.getState();
      if (method === "mosaic") renderMosaic(ctx, video, region, screen, s.mosaicSize);
      else if (method === "mirror") renderMirror(ctx, video, region, screen, s.mirrorSide);
      else if (method === "inpaint") renderInpaint(ctx, video, region, screen);
      else if (method === "temporal") renderTemporal(ctx, video, region, screen, s.temporalRadius);

      const label = labelRef.current;
      if (label) {
        label.style.left = screen.x + "px";
        label.style.top = Math.max(0, screen.y - 18) + "px";
      }

      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [isCanvas, videoRef]);

  /* CSS path (blur / fill) — no RAF needed, browser composites the effect */
  useEffect(() => {
    if (isCanvas || !visible) return;
    const el = cssRef.current;
    const video = videoRef.current;
    if (!el || !video || !currentRegion) return;
    const screen = regionToScreen(currentRegion, video);
    if (!screen) return;

    el.style.left = screen.x + "px";
    el.style.top = screen.y + "px";
    el.style.width = screen.w + "px";
    el.style.height = screen.h + "px";
    el.style.display = "block";

    if (delogoMethod === "blur") {
      const scale = Math.max(screen.sx || 1, screen.sy || 1);
      const px = Math.max(2, store.blurStrength * scale);
      el.style.backdropFilter = `blur(${px}px)`;
      el.style.WebkitBackdropFilter = `blur(${px}px)`;
      el.style.background = "transparent";
      el.style.outline = "1px dashed rgba(59,130,246,0.7)";
      el.style.outlineOffset = "-1px";
    } else if (delogoMethod === "fill") {
      el.style.backdropFilter = "none";
      el.style.WebkitBackdropFilter = "none";
      el.style.background = store.delogoFillColor || "black";
      el.style.opacity = String(store.delogoFillOpacity ?? 1);
      el.style.outline = "1px dashed rgba(244,63,94,0.7)";
      el.style.outlineOffset = "-1px";
    }

    const label = labelRef.current;
    if (label) {
      label.style.left = screen.x + "px";
      label.style.top = Math.max(0, screen.y - 18) + "px";
    }
  }, [isCanvas, visible, delogoMethod, currentRegion, store.blurStrength, store.delogoFillColor, store.delogoFillOpacity, videoRef]);

  if (!visible) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute pointer-events-none"
        style={{ zIndex: 5, display: isCanvas ? "block" : "none" }}
      />
      <div
        ref={cssRef}
        className="absolute pointer-events-none"
        style={{ zIndex: 5, display: isCanvas ? "none" : "block" }}
      />
      <div
        ref={labelRef}
        className="absolute pointer-events-none text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded"
        style={{
          zIndex: 6,
          background: "rgba(244, 63, 94, 0.92)",
          color: "white",
          letterSpacing: "0.5px",
        }}
      >
        Vista previa
      </div>
    </>
  );
}
