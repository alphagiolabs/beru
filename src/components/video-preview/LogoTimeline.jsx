import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  ScanEye,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Maximize2,
  CirclePlus,
} from "lucide-react";
import useEditorStore from "../../stores/useEditorStore";
import { useT } from "../../i18n/useT";
import { importVideosFromDialog } from "../../utils/import-videos";
import { isOpActive } from "../../utils/operation";
import { Button } from "../ui/Button";
import { opModeColor } from "./utils";
import useFilmstripFrames from "./useFilmstripFrames";
import useVideoControls from "./useVideoControls";

const PAD = 14;
const TRACK_H = 44;
const MIN_TL_ZOOM = 1;
const MAX_TL_ZOOM = 20;
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MIN_TICK_PX = 56;
const MIN_TRIM_SECONDS = 0.1;

function fmtClock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function fmtTick(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const whole = Number.isInteger(s) ? String(s) : s.toFixed(1);
  return `${m}:${whole.padStart(Number.isInteger(s) ? 2 : 4, "0")}`;
}

function IconButton({ label, children, ...props }) {
  return (
    <Button
      type="button"
      variant="tertiary"
      size="icon"
      className="logo-tl-icon"
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </Button>
  );
}

export default function LogoTimeline({
  sel,
  videoIdx,
  videoRef,
  duration,
  trimStart,
  trimEnd,
  canUndo,
  canRedo,
  selectedOperationIdx,
  renderLoading,
  renderActive,
  onToggleRender,
}) {
  const t = useT();
  const {
    currentTime,
    playing,
    muted,
    togglePlay: onTogglePlay,
    jumpStart: onJumpStart,
    jumpEnd: onJumpEnd,
    toggleMute: onToggleMute,
    startScrub: onScrubStart,
    scrubTo: onScrub,
    endScrub: onScrubEnd,
  } = useVideoControls(videoRef, {
    duration,
    bounds: { start: trimStart, end: trimEnd },
    videoKey: sel.path,
  });
  const scrollRef = useRef(null);
  const draggingRef = useRef(false);
  const trimDragRef = useRef(null);
  const laneDragRef = useRef(null);
  const [viewW, setViewW] = useState(0);
  const [tlZoom, setTlZoom] = useState(MIN_TL_ZOOM);
  const thumbnail = useEditorStore((s) => s.thumbnailsByPath?.[sel.path] || null);
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const { frames, aspect } = useFilmstripFrames(sel.path, duration);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setTlZoom(MIN_TL_ZOOM), [sel.path]);

  const contentW = Math.max(0, viewW - PAD * 2) * tlZoom;
  const pxPerSec = duration > 0 ? contentW / duration : 0;
  const frac = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const playheadX = PAD + frac * contentW;
  const playheadXRef = useRef(playheadX);
  playheadXRef.current = playheadX;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = playheadXRef.current - el.clientWidth / 2;
  }, [tlZoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing || tlZoom === MIN_TL_ZOOM) return;
    if (playheadX < el.scrollLeft || playheadX > el.scrollLeft + el.clientWidth - PAD) {
      el.scrollLeft = playheadX - PAD * 2;
    }
  }, [playheadX, playing, tlZoom]);

  const ticks = useMemo(() => {
    if (!(pxPerSec > 0)) return [];
    const step = TICK_STEPS.find((s) => s * pxPerSec >= MIN_TICK_PX) ?? TICK_STEPS.at(-1);
    const out = [];
    for (let s = 0; s <= duration + 1e-6; s += step) out.push(s);
    return out;
  }, [pxPerSec, duration]);

  const tiles = useMemo(() => {
    const tileW = TRACK_H * aspect;
    if (!(contentW > 0) || !(tileW > 0)) return [];
    const count = Math.ceil(contentW / tileW);
    const source = frames.length ? frames : thumbnail ? [thumbnail] : [];
    if (!source.length) return [];
    return Array.from({ length: count }, (_, i) => {
      const f = Math.min(0.999, ((i + 0.5) * tileW) / contentW);
      const target = Math.floor(f * source.length);
      let nearest = -1;
      for (let j = 0; j < source.length; j++) {
        if (source[j] && (nearest < 0 || Math.abs(j - target) < Math.abs(nearest - target)))
          nearest = j;
      }
      return { key: i, src: source[nearest] || thumbnail, w: tileW };
    });
  }, [contentW, aspect, frames, thumbnail]);

  const fracFromEvent = (e) => {
    const el = scrollRef.current;
    if (!el || !(contentW > 0)) return null;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft - PAD;
    return Math.max(0, Math.min(1, x / contentW));
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 || !(duration > 0)) return;
    const f = fracFromEvent(e);
    if (f == null) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    onScrubStart();
    onScrub(f);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    const f = fracFromEvent(e);
    if (f != null) onScrub(f);
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onScrubEnd();
  };

  const trimGap = Math.min(MIN_TRIM_SECONDS, duration);
  const changeTrim = (edge, time) => {
    if (!(duration > 0) || isProcessing) return;
    const rounded = Math.round(time * 100) / 100;
    const nextStart =
      edge === "start" ? Math.max(0, Math.min(rounded, trimEnd - trimGap)) : trimStart;
    const nextEnd =
      edge === "end" ? Math.min(duration, Math.max(rounded, trimStart + trimGap)) : trimEnd;
    store().setVideoTrim(videoIdx, nextStart, nextEnd, duration);
    onScrub((edge === "start" ? nextStart : nextEnd) / duration);
  };
  const startTrimDrag = (edge, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0 || isProcessing) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    trimDragRef.current = edge;
    onScrubStart();
  };
  const moveTrimDrag = (e) => {
    if (!trimDragRef.current) return;
    e.stopPropagation();
    const fraction = fracFromEvent(e);
    if (fraction != null) changeTrim(trimDragRef.current, fraction * duration);
  };
  const endTrimDrag = (e) => {
    if (!trimDragRef.current) return;
    e.stopPropagation();
    trimDragRef.current = null;
    onScrubEnd();
  };
  const onTrimKeyDown = (edge, e) => {
    const current = edge === "start" ? trimStart : trimEnd;
    const step = e.shiftKey ? 1 : 0.1;
    const next =
      e.key === "ArrowLeft"
        ? current - step
        : e.key === "ArrowRight"
          ? current + step
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? duration
              : null;
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    changeTrim(edge, next);
  };

  const startLaneDrag = (e, opIdx, op, kind) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    store().selectOperation(opIdx);
    if (isProcessing || !(pxPerSec > 0)) return;
    e.currentTarget.closest(".logo-tl-lane")?.setPointerCapture?.(e.pointerId);
    laneDragRef.current = {
      opIdx,
      kind,
      x0: e.clientX,
      start: op.startTime ?? 0,
      end: op.endTime ?? duration,
      saved: false,
    };
  };
  const moveLaneDrag = (e) => {
    const d = laneDragRef.current;
    if (!d || Math.abs(e.clientX - d.x0) < 3) return;
    const dt = (e.clientX - d.x0) / pxPerSec;
    const len = d.end - d.start;
    let start = d.start;
    let end = d.end;
    if (d.kind === "move") {
      start = Math.max(0, Math.min(duration - len, d.start + dt));
      end = start + len;
    } else if (d.kind === "start") {
      start = Math.max(0, Math.min(d.end - MIN_TRIM_SECONDS, d.start + dt));
    } else {
      end = Math.min(duration, Math.max(d.start + MIN_TRIM_SECONDS, d.end + dt));
    }
    start = Math.round(start * 20) / 20;
    end = Math.round(end * 20) / 20;
    const patch = {
      startTime: start > 0 ? start : null,
      endTime: end < duration - 0.02 ? end : null,
    };
    store().updateOperation(videoIdx, d.opIdx, patch, { recordHistory: !d.saved });
    d.saved = true;
  };
  const endLaneDrag = () => {
    laneDragRef.current = null;
  };

  const zoomBy = (factor) =>
    setTlZoom((z) => Math.min(MAX_TL_ZOOM, Math.max(MIN_TL_ZOOM, z * factor)));

  const store = useEditorStore.getState;
  const hasSelectedOp = selectedOperationIdx != null && selectedOperationIdx >= 0;
  const ops = sel.operations || [];

  return (
    <section className="logo-timeline" aria-label={t("timeline.label")}>
      <div className="logo-tl-bar">
        <div className="logo-tl-group">
          <IconButton label={t("logo.undo")} disabled={!canUndo} onClick={() => store().undo()}>
            <Undo2 size={15} />
          </IconButton>
          <IconButton label={t("logo.redo")} disabled={!canRedo} onClick={() => store().redo()}>
            <Redo2 size={15} />
          </IconButton>
          <span className="logo-tl-sep" aria-hidden />
          <IconButton
            label={t("props.actions.duplicate")}
            disabled={!hasSelectedOp}
            onClick={() => store().duplicateOperation(selectedOperationIdx)}
          >
            <Copy size={15} />
          </IconButton>
          <IconButton
            label={t("props.actions.deleteLayer")}
            disabled={!hasSelectedOp}
            onClick={() => store().removeOperation(selectedOperationIdx)}
          >
            <Trash2 size={15} />
          </IconButton>
          <span className="logo-tl-sep" aria-hidden />
          <IconButton
            label={renderActive ? t("preview.closeRenderFrame") : t("preview.renderFrame")}
            loading={renderLoading}
            aria-pressed={renderActive}
            className={`logo-tl-icon${renderActive ? " is-active" : ""}`}
            onClick={onToggleRender}
          >
            {!renderLoading && <ScanEye size={15} />}
          </IconButton>
          <IconButton
            label={muted ? t("preview.unmute") : t("preview.mute")}
            onClick={onToggleMute}
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </IconButton>
        </div>

        <div className="logo-tl-transport">
          <span className="logo-tl-time">{fmtClock(currentTime)}</span>
          <IconButton label={t("preview.jumpStart")} onClick={onJumpStart}>
            <SkipBack size={15} fill="currentColor" />
          </IconButton>
          <IconButton
            label={t("preview.playPause")}
            className="logo-tl-icon logo-tl-play"
            onClick={onTogglePlay}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </IconButton>
          <IconButton label={t("preview.jumpEnd")} onClick={onJumpEnd}>
            <SkipForward size={15} fill="currentColor" />
          </IconButton>
          <span className="logo-tl-time logo-tl-time--dim">{fmtClock(duration)}</span>
        </div>

        <div className="logo-tl-zoom">
          <IconButton
            label={t("timeline.zoomOut")}
            disabled={tlZoom <= MIN_TL_ZOOM}
            onClick={() => zoomBy(1 / 1.5)}
          >
            <ZoomOut size={15} />
          </IconButton>
          <input
            type="range"
            className="logo-tl-zoom-range"
            min={0}
            max={1}
            step={0.01}
            value={Math.log(tlZoom) / Math.log(MAX_TL_ZOOM)}
            onChange={(e) => setTlZoom(MAX_TL_ZOOM ** Number(e.target.value))}
            aria-label={t("timeline.zoom")}
            style={{ "--fill": `${(Math.log(tlZoom) / Math.log(MAX_TL_ZOOM)) * 100}%` }}
          />
          <IconButton
            label={t("timeline.zoomIn")}
            disabled={tlZoom >= MAX_TL_ZOOM}
            onClick={() => zoomBy(1.5)}
          >
            <ZoomIn size={15} />
          </IconButton>
          <IconButton label={t("timeline.fit")} onClick={() => setTlZoom(MIN_TL_ZOOM)}>
            <Maximize2 size={14} />
          </IconButton>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="logo-tl-scroll"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="logo-tl-content" style={{ width: contentW + PAD * 2 }}>
          <div className="logo-tl-ruler" aria-hidden>
            {ticks.map((s) => (
              <span key={s} className="logo-tl-tick" style={{ left: PAD + s * pxPerSec }}>
                {s > 0 && <span className="logo-tl-tick-label">{fmtTick(s)}</span>}
              </span>
            ))}
          </div>

          <div
            className="logo-tl-clip"
            style={{ left: PAD, width: contentW, height: TRACK_H }}
            title={sel.filename}
          >
            <div className="logo-tl-film">
              {tiles.map((tile) => (
                <img
                  key={tile.key}
                  src={tile.src}
                  alt=""
                  draggable={false}
                  style={{ width: tile.w, height: TRACK_H }}
                />
              ))}
            </div>
            <span className="logo-tl-clip-name">{sel.filename}</span>
            {trimStart > 0 && (
              <span
                className="logo-tl-trim-mask"
                style={{ left: 0, width: trimStart * pxPerSec }}
                aria-hidden
              />
            )}
            {trimEnd < duration && (
              <span
                className="logo-tl-trim-mask"
                style={{ left: trimEnd * pxPerSec, right: 0 }}
                aria-hidden
              />
            )}
            <span
              className="logo-tl-trim-selection"
              style={{ left: trimStart * pxPerSec, width: (trimEnd - trimStart) * pxPerSec }}
              aria-hidden
            />
            {duration > 0 &&
              ["start", "end"].map((edge) => {
                const time = edge === "start" ? trimStart : trimEnd;
                const label = t(edge === "start" ? "timeline.trimStart" : "timeline.trimEnd");
                return (
                  <button
                    key={edge}
                    type="button"
                    role="slider"
                    className={`logo-tl-trim-handle logo-tl-trim-handle--${edge}`}
                    style={{ left: Math.max(0, Math.min(contentW - 16, time * pxPerSec - 8)) }}
                    aria-label={label}
                    aria-valuemin={edge === "start" ? 0 : trimStart + trimGap}
                    aria-valuemax={edge === "start" ? trimEnd - trimGap : duration}
                    aria-valuenow={time}
                    aria-valuetext={fmtClock(time)}
                    disabled={isProcessing}
                    title={`${label}: ${fmtClock(time)}`}
                    onPointerDown={(e) => startTrimDrag(edge, e)}
                    onPointerMove={moveTrimDrag}
                    onPointerUp={endTrimDrag}
                    onPointerCancel={endTrimDrag}
                    onKeyDown={(e) => onTrimKeyDown(edge, e)}
                  />
                );
              })}
          </div>

          {ops.length > 0 && duration > 0 && (
            <div className="logo-tl-lanes">
              {ops.map((op, i) => {
                const start = op.startTime ?? 0;
                const end = op.endTime ?? duration;
                const label = t(`props.mode.${op.mode}`);
                return (
                  <div
                    key={op.id}
                    role="button"
                    tabIndex={0}
                    className={`logo-tl-lane${selectedOperationIdx === i ? " is-selected" : ""}`}
                    style={{
                      left: PAD + start * pxPerSec,
                      width: Math.max(12, (end - start) * pxPerSec),
                      "--lane-color": opModeColor[op.mode] || "#888",
                      opacity: isOpActive(op, currentTime) ? 1 : 0.6,
                    }}
                    title={`${label} ${fmtClock(start)} - ${fmtClock(end)}`}
                    aria-label={label}
                    onPointerDown={(e) => startLaneDrag(e, i, op, "move")}
                    onPointerMove={moveLaneDrag}
                    onPointerUp={endLaneDrag}
                    onPointerCancel={endLaneDrag}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        store().selectOperation(i);
                      }
                    }}
                  >
                    <span
                      className="logo-tl-lane-edge logo-tl-lane-edge--start"
                      onPointerDown={(e) => startLaneDrag(e, i, op, "start")}
                    />
                    <span className="logo-tl-lane-label">{label}</span>
                    <span
                      className="logo-tl-lane-edge logo-tl-lane-edge--end"
                      onPointerDown={(e) => startLaneDrag(e, i, op, "end")}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="logo-tl-playhead" style={{ left: playheadX }} aria-hidden>
            <span className="logo-tl-playhead-head" />
          </div>
        </div>
      </div>

      <div className="logo-tl-trim-info">
        <span>
          {t("timeline.trimRange", { start: fmtClock(trimStart), end: fmtClock(trimEnd) })}
        </span>
        <button
          type="button"
          disabled={isProcessing || (trimStart === 0 && trimEnd === duration)}
          onClick={() => store().setVideoTrim(videoIdx, 0, duration, duration)}
        >
          {t("timeline.resetTrim")}
        </button>
      </div>

      <button
        type="button"
        className="logo-tl-drop"
        disabled={isProcessing}
        onClick={() =>
          importVideosFromDialog({ api: window.api, store: store(), t, busy: isProcessing })
        }
      >
        <CirclePlus size={14} strokeWidth={1.6} aria-hidden />
        {t("timeline.drop")}
      </button>
    </section>
  );
}
