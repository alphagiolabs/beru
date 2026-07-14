import { useEffect, useRef, useState } from "react";
import useEditorStore from "../stores/useEditorStore";
import { regionToScreen } from "../utils/video-utils";
import { PERF_FLAGS } from "../utils/perf-flags.js";

/* ── Per-preview workspace (released on unmount) ─────────────────────── */

function createPreviewWorkspace() {
  return {
    source: { canvas: null, ctx: null },
    tiny: { canvas: null, ctx: null },
    temporalFrames: [],
    // Scratch channel buffers for temporal median (reused every pixel).
    medianRs: null,
    medianGs: null,
    medianBs: null,
    medianWork: null,
  };
}

function releasePreviewWorkspace(ws) {
  if (!ws) return;
  ws.temporalFrames.length = 0;
  for (const cache of [ws.source, ws.tiny]) {
    if (cache.canvas) {
      cache.canvas.width = 0;
      cache.canvas.height = 0;
      cache.canvas = null;
      cache.ctx = null;
    }
  }
}

function getSourceCanvas(w, h, ws) {
  if (!ws.source.canvas) {
    ws.source.canvas = document.createElement("canvas");
    ws.source.ctx = ws.source.canvas.getContext("2d", { willReadFrequently: true });
  }
  const c = ws.source.canvas;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  ws.source.ctx.imageSmoothingEnabled = true;
  ws.source.ctx.imageSmoothingQuality = "high";
  return c;
}

function getTinyCanvas(w, h, ws) {
  if (!ws.tiny.canvas) {
    ws.tiny.canvas = document.createElement("canvas");
    ws.tiny.ctx = ws.tiny.canvas.getContext("2d");
  }
  const c = ws.tiny.canvas;
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

function renderMosaic(ctx, video, region, screen, blockSize, ws) {
  const { sx, sy, sw, sh } = sourceRect(region, video);
  getSourceCanvas(sw, sh, ws);
  const sctx = ws.source.ctx;
  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const data = sctx.getImageData(0, 0, sw, sh).data;

  const cols = Math.max(1, Math.ceil(sw / blockSize));
  const rows = Math.max(1, Math.ceil(sh / blockSize));
  const tiny = getTinyCanvas(cols, rows, ws);
  const tctx = ws.tiny.ctx;
  const tinyData = tctx.createImageData(cols, rows);
  const tData = tinyData.data;

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * blockSize;
      const y0 = by * blockSize;
      const x1 = Math.min(x0 + blockSize, sw);
      const y1 = Math.min(y0 + blockSize, sh);
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
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
  // flipAxis: "h" = horizontal flip (left/right), "v" = vertical (top/bottom)
  if (s === "right") {
    if (sx + sw + sw <= vw) return { srcX: sx + sw, srcY: sy, cw: sw, ch: sh, flipAxis: "h" };
    if (sx >= sw) return { srcX: sx - sw, srcY: sy, cw: sw, ch: sh, flipAxis: "h" };
    const avail = vw - (sx + sw);
    if (avail <= 0) return null;
    const cw = Math.max(1, Math.min(sw, avail));
    return { srcX: Math.max(0, sx + sw), srcY: sy, cw, ch: sh, flipAxis: "h" };
  }
  if (s === "left") {
    if (sx >= sw) return { srcX: sx - sw, srcY: sy, cw: sw, ch: sh, flipAxis: "h" };
    if (sx + sw + sw <= vw) return { srcX: sx + sw, srcY: sy, cw: sw, ch: sh, flipAxis: "h" };
    const avail = sx;
    if (avail <= 0) return null;
    const cw = Math.max(1, Math.min(sw, avail));
    return { srcX: Math.max(0, sx - cw), srcY: sy, cw, ch: sh, flipAxis: "h" };
  }
  if (s === "bottom") {
    if (sy + sh + sh <= vh) return { srcX: sx, srcY: sy + sh, cw: sw, ch: sh, flipAxis: "v" };
    if (sy >= sh) return { srcX: sx, srcY: sy - sh, cw: sw, ch: sh, flipAxis: "v" };
    const avail = vh - (sy + sh);
    if (avail <= 0) return null;
    const ch = Math.max(1, Math.min(sh, avail));
    return { srcX: sx, srcY: Math.max(0, sy + sh), cw: sw, ch, flipAxis: "v" };
  }
  if (sy >= sh) return { srcX: sx, srcY: sy - sh, cw: sw, ch: sh, flipAxis: "v" };
  if (sy + sh + sh <= vh) return { srcX: sx, srcY: sy + sh, cw: sw, ch: sh, flipAxis: "v" };
  const avail = sy;
  if (avail <= 0) return null;
  const ch = Math.max(1, Math.min(sh, avail));
  return { srcX: sx, srcY: Math.max(0, sy - ch), cw: sw, ch, flipAxis: "v" };
}

function renderMirror(ctx, video, region, screen, side) {
  const { sx, sy, sw, sh } = sourceRect(region, video);
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sample = mirrorSampleRect(sx, sy, sw, sh, vw, vh, side);
  // No context on the requested side: draw nothing (matches Python fallback
  // to inpaint, which we can't replicate in a live canvas preview).
  if (!sample) {
    ctx.save();
    ctx.clearRect(0, 0, screen.w, screen.h);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, screen.w, screen.h);
  if (sample.flipAxis === "h") {
    ctx.translate(screen.w, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, screen.h);
    ctx.scale(1, -1);
  }
  ctx.drawImage(video, sample.srcX, sample.srcY, sample.cw, sample.ch, 0, 0, screen.w, screen.h);
  ctx.restore();
}

function renderInpaint(ctx, video, region, screen, ws) {
  const { sx, sy, sw, sh } = sourceRect(region, video);
  const src = getSourceCanvas(sw, sh, ws);
  const sctx = ws.source.ctx;
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
      dData[di] = (sData[ti] * wt + sData[bi] * wb + sData[li] * wl + sData[ri] * wr) / total;
      dData[di + 1] =
        (sData[ti + 1] * wt + sData[bi + 1] * wb + sData[li + 1] * wl + sData[ri + 1] * wr) / total;
      dData[di + 2] =
        (sData[ti + 2] * wt + sData[bi + 2] * wb + sData[li + 2] * wl + sData[ri + 2] * wr) / total;
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

function medianChannel(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * In-place quickselect median (O(n) avg). Mutates `a` (caller builds it fresh).
 * Used when VITE_BERU_DELGO_QUICKSELECT is enabled to avoid the per-pixel full sort.
 */
function quickselectMedian(a) {
  const n = a.length;
  if (n === 0) return 0;
  if (n === 1) return a[0];
  const k = n >> 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i++] = a[j];
        a[j--] = t;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  if (n % 2) return a[k];
  // even n: a[k] is placed; a[k-1] is the max of the lower partition.
  let maxLo = a[0];
  for (let i = 1; i < k; i++) if (a[i] > maxLo) maxLo = a[i];
  return Math.round((maxLo + a[k]) / 2);
}

function renderTemporal(ctx, video, region, screen, radius, ws) {
  const { sx, sy, sw, sh } = sourceRect(region, video);
  const src = getSourceCanvas(sw, sh, ws);
  const sctx = ws.source.ctx;
  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const frame = sctx.getImageData(0, 0, sw, sh);

  const maxFrames = Math.max(3, Math.min(15, radius * 2 + 1));
  ws.temporalFrames.push(frame);
  if (ws.temporalFrames.length > maxFrames) {
    ws.temporalFrames.shift();
  }

  const out = sctx.createImageData(sw, sh);
  const d = out.data;
  const buffers = ws.temporalFrames;
  const n = buffers.length;
  const useQuick = PERF_FLAGS.delogoQuickselect;

  // Reuse fixed-length scratch arrays (no per-pixel alloc).
  if (!ws.medianRs || ws.medianRs.length !== n) {
    ws.medianRs = new Uint8ClampedArray(n);
    ws.medianGs = new Uint8ClampedArray(n);
    ws.medianBs = new Uint8ClampedArray(n);
    ws.medianWork = new Uint8ClampedArray(n);
  }
  const rs = ws.medianRs;
  const gs = ws.medianGs;
  const bs = ws.medianBs;
  const work = ws.medianWork;

  for (let i = 0; i < sw * sh; i++) {
    const o = i * 4;
    for (let f = 0; f < n; f++) {
      const fd = buffers[f].data;
      rs[f] = fd[o];
      gs[f] = fd[o + 1];
      bs[f] = fd[o + 2];
    }
    if (useQuick) {
      work.set(rs);
      d[o] = quickselectMedian(work);
      work.set(gs);
      d[o + 1] = quickselectMedian(work);
      work.set(bs);
      d[o + 2] = quickselectMedian(work);
    } else {
      d[o] = medianChannel(Array.from(rs));
      d[o + 1] = medianChannel(Array.from(gs));
      d[o + 2] = medianChannel(Array.from(bs));
    }
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

/** Methods rendered via the canvas RAF loop (per-frame pixel work).
 *  All other valid methods (blur, fill, cover) use the CSS overlay path. */
const CANVAS_METHODS = new Set(["temporal", "mirror", "mosaic", "inpaint"]);

export default function DelogoLivePreview({ videoRef }) {
  const currentRegion = useEditorStore((s) => s.currentRegion);
  const activeTool = useEditorStore((s) => s.activeTool);
  const sidebarMode = useEditorStore((s) => s.sidebarMode);
  const delogoMethod = useEditorStore((s) => s.delogoMethod);
  const blurStrength = useEditorStore((s) => s.blurStrength);
  const delogoFillColor = useEditorStore((s) => s.delogoFillColor);
  const delogoFillOpacity = useEditorStore((s) => s.delogoFillOpacity);
  const delogoImagePath = useEditorStore((s) => s.delogoImagePath);
  const mosaicSize = useEditorStore((s) => s.mosaicSize);
  const mirrorSide = useEditorStore((s) => s.mirrorSide);
  const temporalRadius = useEditorStore((s) => s.temporalRadius);
  const canvasRef = useRef(null);
  const labelRef = useRef(null);
  const cssRef = useRef(null);
  const [coverImgData, setCoverImgData] = useState(null);
  const workspaceRef = useRef(null);
  if (!workspaceRef.current) {
    workspaceRef.current = createPreviewWorkspace();
  }

  const visible = !!(sidebarMode === "logo" && activeTool === "delogo" && currentRegion);
  const isCanvas = visible && CANVAS_METHODS.has(delogoMethod);

  useEffect(() => () => releasePreviewWorkspace(workspaceRef.current), []);

  /* Reset temporal buffer when region, method, or video source changes. */
  const videoSrc = videoRef?.current?.currentSrc || videoRef?.current?.src || "";
  useEffect(() => {
    workspaceRef.current.temporalFrames.length = 0;
  }, [currentRegion, delogoMethod, videoSrc]);

  /* Canvas path — re-draws every frame while visible */
  useEffect(() => {
    if (!isCanvas) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ws = workspaceRef.current;

    let rafId = 0;
    let timerId = 0;
    let lastDrawTs = 0;
    let pauseController = null;
    const throttleFps = PERF_FLAGS.delogoThrottleFps;
    const throttleInterval = throttleFps > 0 ? 1000 / throttleFps : 0;

    const scheduleNext = () => {
      rafId = requestAnimationFrame(draw);
    };

    const draw = () => {
      const video = videoRef.current;
      const region = useEditorStore.getState().currentRegion;
      const method = useEditorStore.getState().delogoMethod;
      const notReady = !video || !region || video.readyState < 2;
      if (document.hidden) {
        timerId = setTimeout(draw, 1000);
        return;
      }
      // Backoff when the video isn't ready instead of spinning at RAF rate.
      if (notReady) {
        timerId = setTimeout(draw, 100);
        return;
      }
      // FPS throttle (flag-gated; 0 = uncapped legacy behaviour).
      if (throttleInterval > 0) {
        const now = performance.now();
        const remaining = throttleInterval - (now - lastDrawTs);
        if (remaining > 0) {
          timerId = setTimeout(draw, remaining);
          return;
        }
        lastDrawTs = now;
      }
      const screen = regionToScreen(region, video);
      if (!screen || screen.w < 1 || screen.h < 1) {
        scheduleNext();
        return;
      }

      const w = Math.max(1, Math.round(screen.w));
      const h = Math.max(1, Math.round(screen.h));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const bw = Math.max(1, Math.round(w * dpr));
      const bh = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      canvas.style.left = screen.x + "px";
      canvas.style.top = screen.y + "px";
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";

      const ctx = canvas.getContext("2d");
      if (typeof ctx.setTransform === "function") ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (method === "mosaic") renderMosaic(ctx, video, region, screen, mosaicSize, ws);
      else if (method === "mirror") renderMirror(ctx, video, region, screen, mirrorSide);
      else if (method === "inpaint") renderInpaint(ctx, video, region, screen, ws);
      else if (method === "temporal")
        renderTemporal(ctx, video, region, screen, temporalRadius, ws);

      const label = labelRef.current;
      if (label) {
        label.style.left = screen.x + "px";
        label.style.top = Math.max(0, screen.y - 18) + "px";
      }

      // Pause the loop while the video is paused — the frame is static, so
      // redrawing only burns CPU. Resume on play/seeked.
      if (video.paused) {
        if (!pauseController) {
          pauseController = new AbortController();
          const resume = () => {
            pauseController = null;
            scheduleNext();
          };
          video.addEventListener("play", resume, { once: true, signal: pauseController.signal });
          video.addEventListener("seeked", resume, { once: true, signal: pauseController.signal });
        }
        return;
      }
      scheduleNext();
    };
    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      if (pauseController) pauseController.abort();
    };
  }, [isCanvas, videoRef, mosaicSize, mirrorSide, temporalRadius]);

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
      const px = Math.max(2, blurStrength * scale);
      el.style.backdropFilter = `blur(${px}px)`;
      el.style.WebkitBackdropFilter = `blur(${px}px)`;
      el.style.background = "transparent";
      el.style.outline = "1px dashed rgba(59,130,246,0.7)";
      el.style.outlineOffset = "-1px";
    } else if (delogoMethod === "fill") {
      el.style.backdropFilter = "none";
      el.style.WebkitBackdropFilter = "none";
      el.style.background = delogoFillColor || "black";
      el.style.opacity = String(delogoFillOpacity ?? 1);
      el.style.outline = "1px dashed rgba(244,63,94,0.7)";
      el.style.outlineOffset = "-1px";
    } else if (delogoMethod === "cover") {
      // Cover: show the user's image scaled to the logo box (contain fit,
      // matching the Python pad=...:(ow-iw)/2:(oh-ih)/2 overlay).
      el.style.backdropFilter = "none";
      el.style.WebkitBackdropFilter = "none";
      el.style.background = "transparent";
      el.style.opacity = "1";
      el.style.outline = "1px dashed rgba(16,185,129,0.7)";
      el.style.outlineOffset = "-1px";
    }

    const label = labelRef.current;
    if (label) {
      label.style.left = screen.x + "px";
      label.style.top = Math.max(0, screen.y - 18) + "px";
    }
  }, [
    isCanvas,
    visible,
    delogoMethod,
    currentRegion,
    blurStrength,
    delogoFillColor,
    delogoFillOpacity,
    delogoImagePath,
    videoRef,
  ]);

  /* Cover image: load on demand and render as a background-image on the CSS
     overlay div so it scales with the region without a separate canvas. */
  useEffect(() => {
    if (!visible || delogoMethod !== "cover") {
      setCoverImgData(null);
      return;
    }
    if (!delogoImagePath) {
      setCoverImgData(null);
      return;
    }
    // Reuse the Electron-preloaded data URL cache when available (the image
    // op path uses the same cache); fall back to a raw file URL.
    const cached = useEditorStore.getState().imageDataCache?.[delogoImagePath];
    if (cached) {
      setCoverImgData(cached);
      return;
    }
    setCoverImgData(null);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      try {
        setCoverImgData(canvas.toDataURL("image/png"));
      } catch {
        setCoverImgData(null);
      }
    };
    img.src = `beru://local/${encodeURIComponent(delogoImagePath)}`;
    return () => {
      cancelled = true;
    };
  }, [visible, delogoMethod, delogoImagePath]);

  if (!visible) return null;

  const isCover = delogoMethod === "cover";
  const coverUrl = isCover ? coverImgData : null;

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
      >
        {isCover && coverUrl && (
          <img
            src={coverUrl}
            alt=""
            className="w-full h-full"
            style={{ objectFit: "contain" }}
            draggable={false}
          />
        )}
      </div>
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
