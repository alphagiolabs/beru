import { useEffect, useRef, useState } from "react";
import useEditorStore from "../stores/useEditorStore";
import { regionToScreen } from "../utils/video-utils";
import { createDelogoRenderBridge } from "../utils/delogo-render-bridge.js";
import { spatialLogoFallback, temporalSampleSize } from "../utils/delogo-render-core.js";
import {
  logoSourceRect as sourceRect,
  logoPreviewGeometry,
  paddedLogoRect,
} from "../utils/delogo-preview-geometry.js";
import { useThrottledVideoDraw } from "./video-preview/use-throttled-video-draw.js";
import { isOpActive } from "../utils/operation.js";
import { beruLocalUrl } from "../utils/beru-url.js";
import { useT } from "../i18n/useT";

const previewWorkspaces = new WeakMap();
const MAX_WORKSPACE_CANVASES = 8;

function getPreviewWorkspace(video) {
  let ws = previewWorkspaces.get(video);
  if (!ws) {
    ws = new Map();
    previewWorkspaces.set(video, ws);
  }
  return ws;
}

function getWorkspaceCanvas(ws, role, w, h, willReadFrequently) {
  const key = `${role}:${w}x${h}`;
  const hit = ws.get(key);
  if (hit) {
    ws.delete(key);
    ws.set(key, hit);
    return hit;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const entry = { canvas, ctx: canvas.getContext("2d", { willReadFrequently }) };
  ws.set(key, entry);
  if (ws.size > MAX_WORKSPACE_CANVASES) {
    const oldest = ws.keys().next().value;
    const evicted = ws.get(oldest);
    evicted.canvas.width = 0;
    evicted.canvas.height = 0;
    ws.delete(oldest);
  }
  return entry;
}

function getSourceCanvas(w, h, ws) {
  const entry = getWorkspaceCanvas(ws, "source", w, h, true);
  entry.ctx.imageSmoothingEnabled = true;
  entry.ctx.imageSmoothingQuality = "high";
  return entry;
}

function getTinyCanvas(w, h, ws) {
  return getWorkspaceCanvas(ws, "tiny", w, h, false);
}

function paintResult(ws, ctx, screen, result, target, smooth, crop = null) {
  const { canvas, ctx: targetCtx } =
    target === "tiny"
      ? getTinyCanvas(result.width, result.height, ws)
      : getSourceCanvas(result.width, result.height, ws);
  const out = targetCtx.createImageData(result.width, result.height);
  out.data.set(result.data);
  targetCtx.putImageData(out, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  ctx.clearRect(0, 0, screen.w, screen.h);
  ctx.drawImage(
    canvas,
    crop ? crop.x - (result.x ?? 0) : 0,
    crop ? crop.y - (result.y ?? 0) : 0,
    crop?.w ?? result.width,
    crop?.h ?? result.height,
    0,
    0,
    screen.w,
    screen.h,
  );
  ctx.restore();
}

function captureSourceFrame(ws, video, rect, outW, outH) {
  const { ctx: sctx } = getSourceCanvas(outW, outH, ws);
  sctx.clearRect(0, 0, outW, outH);
  sctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outW, outH);
  return sctx.getImageData(0, 0, outW, outH);
}

function captureLogoPatch(ws, video, rect, geometry, screen, feather) {
  const selection = geometry.repair;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const { sampleW, sampleH } = temporalSampleSize(
    rect.sw,
    rect.sh,
    Math.max(320, Math.ceil((screen.w * dpr * rect.sw) / geometry.effect.sw)),
    Math.max(180, Math.ceil((screen.h * dpr * rect.sh) / geometry.effect.sh)),
  );
  const scaleX = sampleW / rect.sw;
  const scaleY = sampleH / rect.sh;
  const x = Math.floor((selection.sx - rect.sx) * scaleX);
  const y = Math.floor((selection.sy - rect.sy) * scaleY);
  const right = Math.ceil((selection.sx + selection.sw - rect.sx) * scaleX);
  const bottom = Math.ceil((selection.sy + selection.sh - rect.sy) * scaleY);
  return {
    frame: captureSourceFrame(ws, video, rect, sampleW, sampleH),
    width: sampleW,
    height: sampleH,
    box: { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) },
    scale: Math.min(scaleX, scaleY),
    feather: feather * Math.min(scaleX, scaleY),
    crop: {
      x: (geometry.effect.sx - rect.sx) * scaleX,
      y: (geometry.effect.sy - rect.sy) * scaleY,
      w: geometry.effect.sw * scaleX,
      h: geometry.effect.sh * scaleY,
    },
  };
}

function submitMosaic(bridge, ws, video, region, screen, blockSize, ctx, isCurrent) {
  const rect = sourceRect(region, video);
  const frame = captureSourceFrame(ws, video, rect, rect.sw, rect.sh);
  bridge.compute(
    {
      method: "mosaic",
      params: { blockSize },
      frame,
      width: rect.sw,
      height: rect.sh,
      context: { screen },
    },
    (context, result) => {
      if (isCurrent()) paintResult(ws, ctx, context.screen, result, "tiny", false);
    },
  );
}

function mirrorSampleRect(sx, sy, sw, sh, vw, vh, side) {
  const s = (side || "right").toLowerCase();
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

function renderLogoPatch(
  bridge,
  ws,
  video,
  ctx,
  screen,
  patch,
  params,
  method,
  isCurrent,
  runWorker,
) {
  const { crop } = patch;
  if (!video.paused) {
    paintResult(
      ws,
      ctx,
      screen,
      spatialLogoFallback(patch.frame.data, patch.width, patch.height, params, method),
      "source",
      true,
      crop,
    );
    return;
  }
  if (!runWorker) return;
  bridge.compute(
    {
      method,
      params,
      frame: patch.frame,
      width: patch.width,
      height: patch.height,
      context: { screen, crop },
    },
    (context, result) => {
      if (isCurrent()) paintResult(ws, ctx, context.screen, result, "source", true, context.crop);
    },
  );
}

function submitBlur(
  bridge,
  ws,
  video,
  geometry,
  screen,
  ctx,
  strength,
  feather,
  isCurrent,
  runWorker,
) {
  const radius = Math.max(1, Math.floor(Math.max(1, Math.min(100, Number(strength) || 20)) / 3));
  const rect = paddedLogoRect(geometry.effect, video, 3 * radius);
  const patch = captureLogoPatch(ws, video, rect, geometry, screen, feather);
  const params = {
    radius: Math.max(1, Math.round(radius * patch.scale)),
    box: patch.box,
    feather: patch.feather,
  };
  renderLogoPatch(bridge, ws, video, ctx, screen, patch, params, "blur", isCurrent, runWorker);
}

function submitInpaint(
  bridge,
  ws,
  video,
  geometry,
  screen,
  ctx,
  blurStrength,
  feather,
  isCurrent,
  timestamp,
  runWorker,
) {
  const rect = geometry.selection;
  if (
    rect.sx === 0 ||
    rect.sy === 0 ||
    rect.sx + rect.sw === video.videoWidth ||
    rect.sy + rect.sh === video.videoHeight
  ) {
    submitBlur(
      bridge,
      ws,
      video,
      geometry,
      screen,
      ctx,
      blurStrength,
      feather,
      isCurrent,
      runWorker,
    );
    return;
  }
  const rectWithContext = paddedLogoRect(geometry.effect, video, 96);
  const patch = captureLogoPatch(ws, video, rectWithContext, geometry, screen, feather);
  if (
    patch.box.x < 1 ||
    patch.box.y < 1 ||
    patch.box.x + patch.box.w >= patch.width ||
    patch.box.y + patch.box.h >= patch.height
  ) {
    submitBlur(
      bridge,
      ws,
      video,
      geometry,
      screen,
      ctx,
      blurStrength,
      feather,
      isCurrent,
      runWorker,
    );
    return;
  }
  const params = {
    box: patch.box,
    feather: patch.feather,
    smoothRadius: Math.round(2 * patch.scale),
    guard: Math.max(1, Math.round(2 * patch.scale)),
    referenceGuard: Math.max(1, Math.ceil(patch.scale)),
    search: Math.max(4, Math.round(96 * patch.scale)),
    radius: 3,
    timestamp,
  };
  renderLogoPatch(bridge, ws, video, ctx, screen, patch, params, "inpaint", isCurrent, runWorker);
}

function submitTemporal(
  bridge,
  ws,
  video,
  geometry,
  screen,
  radius,
  ctx,
  strength,
  feather,
  isCurrent,
  timestamp,
  runWorker,
) {
  const selection = geometry.selection;
  if (
    selection.sx === 0 ||
    selection.sy === 0 ||
    selection.sx + selection.sw === video.videoWidth ||
    selection.sy + selection.sh === video.videoHeight
  ) {
    submitBlur(bridge, ws, video, geometry, screen, ctx, strength, feather, isCurrent, runWorker);
    return;
  }
  const rect = paddedLogoRect(geometry.effect, video, 32);
  const patch = captureLogoPatch(ws, video, rect, geometry, screen, feather);
  if (
    patch.box.x < 1 ||
    patch.box.y < 1 ||
    patch.box.x + patch.box.w >= patch.width ||
    patch.box.y + patch.box.h >= patch.height
  ) {
    submitBlur(bridge, ws, video, geometry, screen, ctx, strength, feather, isCurrent, runWorker);
    return;
  }
  const params = {
    radius,
    box: patch.box,
    feather: patch.feather,
    smoothRadius: Math.round(2 * patch.scale),
    guard: Math.max(1, Math.round(2 * patch.scale)),
    referenceGuard: Math.max(1, Math.ceil(patch.scale)),
    timestamp,
  };
  renderLogoPatch(bridge, ws, video, ctx, screen, patch, params, "temporal", isCurrent, runWorker);
}

const CANVAS_METHODS = new Set(["temporal", "mirror", "mosaic", "inpaint", "blur"]);

export default function DelogoLivePreview({ videoRef, operation = null }) {
  const t = useT();
  const draftRegion = useEditorStore((s) => s.currentRegion);
  const activeTool = useEditorStore((s) => s.activeTool);
  const sidebarMode = useEditorStore((s) => s.sidebarMode);
  const draftMethod = useEditorStore((s) => s.delogoMethod);
  const draftBlurStrength = useEditorStore((s) => s.blurStrength);
  const draftFeather = useEditorStore((s) => s.edgeFeather);
  const draftFillColor = useEditorStore((s) => s.delogoFillColor);
  const draftFillOpacity = useEditorStore((s) => s.delogoFillOpacity);
  const draftImagePath = useEditorStore((s) => s.delogoImagePath);
  const draftImageV = useEditorStore((s) => s.delogoImageV);
  const draftMosaicSize = useEditorStore((s) => s.mosaicSize);
  const draftMirrorSide = useEditorStore((s) => s.mirrorSide);
  const draftTemporalRadius = useEditorStore((s) => s.temporalRadius);
  const draftStartTime = useEditorStore((s) => s.tempStart);
  const draftEndTime = useEditorStore((s) => s.tempEnd);
  const currentRegion = operation?.region ?? draftRegion;
  const delogoMethod = operation?.delogoMethod ?? draftMethod;
  const blurStrength = operation?.blurStrength ?? draftBlurStrength;
  const feather = Math.max(
    0,
    Math.min(40, Math.floor(Number(operation?.edgeFeather ?? draftFeather) || 0)),
  );
  const delogoFillColor = operation?.delogoFillColor ?? draftFillColor;
  const delogoFillOpacity = operation?.delogoFillOpacity ?? draftFillOpacity;
  const delogoImagePath = operation?.delogoImagePath ?? draftImagePath;
  const delogoImageV = operation?.delogoImageV ?? draftImageV;
  const mosaicSize = operation?.mosaicSize ?? draftMosaicSize;
  const mirrorSide = operation?.mirrorSide ?? draftMirrorSide;
  const temporalRadius = operation?.temporalRadius ?? draftTemporalRadius;
  const startTime = operation ? operation.startTime : draftStartTime;
  const endTime = operation ? operation.endTime : draftEndTime;
  const canvasRef = useRef(null);
  const labelRef = useRef(null);
  const cssRef = useRef(null);
  const [coverImgData, setCoverImgData] = useState(null);
  const [drawRevision, setDrawRevision] = useState(0);
  const bridgeRef = useRef(null);
  const drawTokenRef = useRef(0);
  const getBridge = () => {
    if (!bridgeRef.current)
      bridgeRef.current = createDelogoRenderBridge({
        onUnavailable: () => setDrawRevision((value) => value + 1),
      });
    return bridgeRef.current;
  };

  const visible = !!(
    operation ||
    (sidebarMode === "logo" && activeTool === "delogo" && currentRegion)
  );
  const isCanvas = visible && CANVAS_METHODS.has(delogoMethod);

  useEffect(
    () => () => {
      bridgeRef.current?.release();
      bridgeRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!isCanvas) {
      bridgeRef.current?.reset();
    }
  }, [isCanvas]);

  const videoSrc = videoRef?.current?.currentSrc || videoRef?.current?.src || "";
  useEffect(() => {
    bridgeRef.current?.reset();
  }, [
    currentRegion,
    delogoMethod,
    videoSrc,
    feather,
    blurStrength,
    mosaicSize,
    mirrorSide,
    temporalRadius,
    startTime,
    endTime,
  ]);

  useEffect(() => {
    if (!isCanvas) return;
    const video = videoRef.current;
    if (!video) return;
    const clearFrames = () => {
      drawTokenRef.current++;
      bridgeRef.current?.reset();
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.visibility = "hidden";
        canvas
          .getContext("2d")
          ?.clearRect(-canvas.width, -canvas.height, 2 * canvas.width, 2 * canvas.height);
      }
    };
    video.addEventListener("seeking", clearFrames);
    video.addEventListener("seeked", clearFrames);
    video.addEventListener("emptied", clearFrames);
    return () => {
      drawTokenRef.current++;
      video.removeEventListener("seeking", clearFrames);
      video.removeEventListener("seeked", clearFrames);
      video.removeEventListener("emptied", clearFrames);
    };
  }, [isCanvas, videoRef, videoSrc]);

  useThrottledVideoDraw({
    enabled: isCanvas,
    syncFrames: ["inpaint", "temporal", "blur"].includes(delogoMethod),
    videoRef,
    canvasRef,
    getRegion: () => {
      const region = operation?.region ?? useEditorStore.getState().currentRegion;
      const video = videoRef.current;
      return region && video && ["inpaint", "blur", "temporal"].includes(delogoMethod)
        ? logoPreviewGeometry(region, video, feather, delogoMethod).region
        : region;
    },
    paint: (ctx, video, region, screen, frame) => {
      const token = ++drawTokenRef.current;
      const clock = video.currentTime;
      const source = video.currentSrc || video.src;
      const isCurrent = () =>
        drawTokenRef.current === token &&
        !video.seeking &&
        (video.currentSrc || video.src) === source &&
        (!video.paused || video.currentTime === clock);
      const timestamp = frame?.mediaTime ?? clock;
      const active = isOpActive({ startTime, endTime }, video.currentTime);
      canvasRef.current.style.visibility = active ? "visible" : "hidden";
      if (!active) {
        bridgeRef.current?.reset();
        ctx.clearRect(0, 0, screen.w, screen.h);
        return;
      }
      const ws = getPreviewWorkspace(video);
      const bridge = getBridge();
      const selectedRegion = operation?.region ?? useEditorStore.getState().currentRegion;
      const geometry = logoPreviewGeometry(selectedRegion, video, feather, delogoMethod);
      if (delogoMethod === "mosaic")
        submitMosaic(bridge, ws, video, region, screen, mosaicSize, ctx, isCurrent);
      else if (delogoMethod === "mirror") renderMirror(ctx, video, region, screen, mirrorSide);
      else if (delogoMethod === "inpaint")
        submitInpaint(
          bridge,
          ws,
          video,
          geometry,
          screen,
          ctx,
          blurStrength,
          feather,
          isCurrent,
          timestamp,
          !frame?.skipWorker,
        );
      else if (delogoMethod === "blur")
        submitBlur(
          bridge,
          ws,
          video,
          geometry,
          screen,
          ctx,
          blurStrength,
          feather,
          isCurrent,
          !frame?.skipWorker,
        );
      else if (delogoMethod === "temporal")
        submitTemporal(
          bridge,
          ws,
          video,
          geometry,
          screen,
          temporalRadius,
          ctx,
          blurStrength,
          feather,
          isCurrent,
          timestamp,
          !frame?.skipWorker,
        );
    },
    afterDraw: (screen) => {
      const label = labelRef.current;
      if (label) {
        label.style.left = screen.x + "px";
        label.style.top = Math.max(0, screen.y - 18) + "px";
      }
    },
    deps: [
      drawRevision,
      currentRegion,
      delogoMethod,
      mosaicSize,
      mirrorSide,
      temporalRadius,
      blurStrength,
      feather,
      startTime,
      endTime,
    ],
  });

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

    if (delogoMethod === "fill") {
      el.style.background = delogoFillColor || "black";
      el.style.opacity = String(delogoFillOpacity ?? 1);
      el.style.outline = "1px dashed rgba(244,63,94,0.7)";
      el.style.outlineOffset = "-1px";
    } else if (delogoMethod === "cover") {
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
    delogoFillColor,
    delogoFillOpacity,
    delogoImagePath,
    videoRef,
  ]);

  useEffect(() => {
    if (!visible || delogoMethod !== "cover") {
      setCoverImgData(null);
      return;
    }
    if (!delogoImagePath) {
      setCoverImgData(null);
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
    img.src = beruLocalUrl(delogoImagePath, delogoImageV);
    return () => {
      cancelled = true;
    };
  }, [visible, delogoMethod, delogoImagePath, delogoImageV]);

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
      {!operation && (
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
          {t("logo.quickPreview")}
        </div>
      )}
    </>
  );
}
