import { useEffect, useRef, useState } from "react";
import { ContextMenu } from "radix-ui";
import {
  Copy,
  Film,
  ImagePlus,
  Maximize2,
  Redo2,
  Scissors,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Tooltip } from "../../components/ui/tooltip";
import { useT } from "../../i18n/useT";
import { trimClip, updateOverlay } from "../../../shared/editor-timeline.js";
import TimelineClip from "./TimelineClip.jsx";
import { ASSET_DRAG_TYPE, IMAGE_DRAG_TYPE, formatClock, usToSeconds } from "./editor-model.js";
import { useEditorSession } from "./store/useEditorSession.js";
import { useTimelineStore } from "./store/useTimelineStore.js";
import {
  beginTimelineGesture,
  cancelTimelineGesture,
  endTimelineGesture,
  previewClipOperation,
  previewMoveClip,
} from "./editor-actions.js";
import {
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  dropIndex,
  fitPxPerSecond,
  isInView,
  overlayWindow,
  pxToUs,
  snapCandidates,
  snapTime,
  trimmedWindow,
  usToPx,
} from "./timeline/geometry.js";

const RULER_STEPS_S = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const DRAG_THRESHOLD_PX = 3;
const MAX_RULER_TICKS = 600;

function rulerStepSeconds(pxPerSecond) {
  return RULER_STEPS_S.find((step) => step * pxPerSecond >= 70) ?? RULER_STEPS_S.at(-1);
}

function ToolButton({ label, shortcut, onClick, disabled = false, children }) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        className="editor-icon-button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function PlayheadMarker({ pxPerSecond }) {
  const playhead = useEditorSession((s) => s.playhead);
  return (
    <div className="editor-playhead" style={{ left: usToPx(playhead, pxPerSecond) }} aria-hidden />
  );
}

export default function EditorTimeline({
  layout,
  duration,
  assetsById,
  assetStatus,
  overlays,
  onAddTitle,
  onAddImage,
  onSplit,
  onDuplicate,
  onDelete,
  onImport,
  onDropAsset,
}) {
  const t = useT();
  const pxPerSecond = useEditorSession((s) => s.pxPerSecond);
  const selectedClipId = useEditorSession((s) => s.selectedClipId);
  const selectedOverlayId = useEditorSession((s) => s.selectedOverlayId);
  const playhead = useEditorSession((s) => s.playhead);
  const playing = useEditorSession((s) => s.playing);
  const canUndo = useTimelineStore((s) => s.history.past.length > 0);
  const canRedo = useTimelineStore((s) => s.history.future.length > 0);
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const drag = useRef(null);
  const hoverLineRef = useRef(null);
  const [dropPx, setDropPx] = useState(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const measure = () => setViewportWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || !playing) return;
    const headPx = usToPx(playhead, pxPerSecond);
    const visibleEnd = element.scrollLeft + element.clientWidth;
    if (headPx < element.scrollLeft || headPx > visibleEnd - 24) {
      element.scrollLeft = Math.max(0, headPx - element.clientWidth * 0.2);
    }
  }, [playhead, playing, pxPerSecond]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const current = drag.current;
      if (event.key !== "Escape" || !current || current.mode === "scrub" || !current.moved) return;
      cancelTimelineGesture();
      drag.current = null;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const trackWidth = Math.max(viewportWidth, usToPx(duration, pxPerSecond) + 120);
  const step = rulerStepSeconds(pxPerSecond);
  const totalSeconds = usToSeconds(duration);
  const ticks = [];
  for (let s = 0; s <= totalSeconds + step / 2 && ticks.length < MAX_RULER_TICKS; s += step) {
    ticks.push(s);
  }

  const timeAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, pxToUs(clientX - rect.left, pxPerSecond));
  };

  const scrubTo = (timeUs) => {
    const session = useEditorSession.getState();
    const snapped = snapTime(timeUs, snapCandidates(layout, session.playhead), pxPerSecond);
    session.setPlaying(false);
    session.setPlayhead(Math.min(duration, Math.max(0, snapped)));
  };

  const startDrag = (entry, mode, event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    useEditorSession.getState().selectClip(entry.clip.id);
    drag.current = {
      mode,
      clipId: entry.clip.id,
      entry,
      clip: entry.clip,
      startX: event.clientX,
      moved: false,
      lastIndex: null,
      startLayout: layout,
      assetDurationUs: assetsById[entry.clip.assetId]?.metadata?.durationUs ?? null,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const startOverlayDrag = (overlay, mode, event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    useEditorSession.getState().selectOverlay(overlay.id);
    drag.current = { mode, overlay, startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onTrackPointerDown = (event) => {
    if (event.button !== 0 || drag.current) return;
    if (event.target.closest?.(".timeline-clip, .timeline-overlay")) return;
    drag.current = { mode: "scrub", startX: event.clientX, moved: true };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrubTo(timeAt(event.clientX));
  };

  const onTrackPointerMove = (event) => {
    const line = hoverLineRef.current;
    if (line) {
      const x = event.clientX - trackRef.current.getBoundingClientRect().left;
      line.style.transform = `translateX(${x}px)`;
      line.style.opacity = "1";
    }
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.startX;
    if (!current.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      current.moved = true;
      beginTimelineGesture();
    }
    if (current.mode === "scrub") {
      scrubTo(timeAt(event.clientX));
      return;
    }
    const deltaUs = pxToUs(dx, pxPerSecond);
    if (current.overlay) {
      const playheadUs = useEditorSession.getState().playhead;
      const snap = (us) => snapTime(us, snapCandidates(layout, playheadUs), pxPerSecond);
      const window = overlayWindow(current.overlay, current.mode, deltaUs, snap);
      previewClipOperation((project) => updateOverlay(project, current.overlay.id, window));
      return;
    }
    if (current.mode === "move") {
      const centerUs = (current.entry.startUs + current.entry.endUs) / 2 + deltaUs;
      const index = dropIndex(current.startLayout, centerUs, current.clipId);
      if (index !== current.lastIndex) {
        current.lastIndex = index;
        previewMoveClip(current.clipId, index);
      }
      return;
    }
    const edge = current.mode === "trim-start" ? "start" : "end";
    const edgeUs = edge === "start" ? current.entry.startUs : current.entry.endUs;
    const snappedUs = snapTime(
      edgeUs + deltaUs,
      snapCandidates(layout, useEditorSession.getState().playhead, current.clipId),
      pxPerSecond,
    );
    const window = trimmedWindow(current.clip, edge, snappedUs - edgeUs, current.assetDurationUs);
    previewClipOperation((project) => trimClip(project, current.clipId, window));
  };

  const finishDrag = (event) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current.mode !== "scrub" && current.moved) endTimelineGesture();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const hideHoverLine = () => {
    if (hoverLineRef.current) hoverLineRef.current.style.opacity = "0";
  };

  const onDragOver = (event) => {
    const { types } = event.dataTransfer;
    if (!types.includes(ASSET_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const timeUs = timeAt(event.clientX);
    if (types.includes(IMAGE_DRAG_TYPE)) {
      setDropPx(usToPx(timeUs, pxPerSecond));
      return;
    }
    const index = dropIndex(layout, timeUs, null);
    setDropPx(usToPx(layout[index]?.startUs ?? duration, pxPerSecond));
  };

  const onDrop = (event) => {
    const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
    setDropPx(null);
    if (!assetId) return;
    event.preventDefault();
    onDropAsset(assetId, Math.min(duration, timeAt(event.clientX)));
  };

  const selectUnderPointer = (event) => {
    const session = useEditorSession.getState();
    const clipId = event.target.closest?.("[data-clip-id]")?.dataset.clipId;
    const overlayId = event.target.closest?.("[data-overlay-id]")?.dataset.overlayId;
    if (clipId) session.selectClip(clipId);
    else if (overlayId) session.selectOverlay(overlayId);
  };

  const zoomBy = (factor) => useEditorSession.getState().setZoom(pxPerSecond * factor);
  const fitZoom = () =>
    useEditorSession.getState().setZoom(fitPxPerSecond(duration, viewportWidth - 32));

  return (
    <section className="editor-timeline" aria-label={t("editor.timeline.title")}>
      <header className="editor-timeline-head">
        <div className="editor-tool-group">
          <ToolButton
            label={t("editor.undo")}
            shortcut="Ctrl+Z"
            disabled={!canUndo}
            onClick={() => useTimelineStore.getState().undo()}
          >
            <Undo2 size={15} strokeWidth={1.75} />
          </ToolButton>
          <ToolButton
            label={t("editor.redo")}
            shortcut="Ctrl+Y"
            disabled={!canRedo}
            onClick={() => useTimelineStore.getState().redo()}
          >
            <Redo2 size={15} strokeWidth={1.75} />
          </ToolButton>
          <span className="editor-tool-divider" aria-hidden />
          <ToolButton
            label={t("editor.split")}
            shortcut="S"
            disabled={layout.length === 0}
            onClick={onSplit}
          >
            <Scissors size={15} strokeWidth={1.75} />
          </ToolButton>
          <ToolButton
            label={t("editor.duplicate")}
            shortcut="D"
            disabled={!selectedClipId}
            onClick={onDuplicate}
          >
            <Copy size={15} strokeWidth={1.75} />
          </ToolButton>
          <ToolButton
            label={t("editor.delete")}
            disabled={!selectedClipId && !selectedOverlayId}
            onClick={onDelete}
          >
            <Trash2 size={15} strokeWidth={1.75} />
          </ToolButton>
          <span className="editor-tool-divider" aria-hidden />
          <button type="button" className="editor-text-tool" onClick={onAddTitle}>
            <Type size={14} strokeWidth={1.75} />
            {t("editor.addTitle")}
          </button>
          <button type="button" className="editor-text-tool" onClick={onAddImage}>
            <ImagePlus size={14} strokeWidth={1.75} />
            {t("editor.addImage")}
          </button>
        </div>
        <div className="editor-tool-group">
          <span className="editor-time editor-timeline-duration">{formatClock(totalSeconds)}</span>
          <ToolButton
            label={t("editor.timeline.zoomOut")}
            shortcut="-"
            onClick={() => zoomBy(1 / 1.5)}
          >
            <ZoomOut size={15} strokeWidth={1.75} />
          </ToolButton>
          <input
            type="range"
            className="editor-zoom-slider"
            min={Math.log(MIN_PX_PER_SECOND)}
            max={Math.log(MAX_PX_PER_SECOND)}
            step={0.01}
            value={Math.log(pxPerSecond)}
            onChange={(event) =>
              useEditorSession.getState().setZoom(Math.exp(Number(event.target.value)))
            }
            aria-label={t("editor.timeline.zoom")}
          />
          <ToolButton label={t("editor.timeline.zoomIn")} shortcut="+" onClick={() => zoomBy(1.5)}>
            <ZoomIn size={15} strokeWidth={1.75} />
          </ToolButton>
          <ToolButton label={t("editor.timeline.fit")} onClick={fitZoom}>
            <Maximize2 size={14} strokeWidth={1.75} />
          </ToolButton>
        </div>
      </header>
      <div
        className="editor-timeline-viewport"
        ref={viewportRef}
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDropPx(null);
        }}
        onDrop={onDrop}
      >
        {layout.length === 0 ? (
          <button type="button" className="editor-timeline-placeholder" onClick={onImport}>
            <Film size={20} strokeWidth={1.5} aria-hidden />
            <span>{t("editor.timeline.empty")}</span>
          </button>
        ) : null}
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild onContextMenu={selectUnderPointer}>
            <div
              className="editor-timeline-track"
              ref={trackRef}
              style={{ width: trackWidth }}
              onPointerDown={onTrackPointerDown}
              onPointerMove={onTrackPointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onPointerLeave={hideHoverLine}
            >
              <div className="editor-timeline-ruler" aria-hidden>
                {ticks.map((seconds) => (
                  <span key={seconds} style={{ left: usToPx(seconds * 1_000_000, pxPerSecond) }}>
                    {formatClock(seconds)}
                  </span>
                ))}
              </div>
              <div className="editor-timeline-lane">
                {layout.map((entry) => {
                  const startPx = usToPx(entry.startUs, pxPerSecond);
                  const endPx = usToPx(entry.endUs, pxPerSecond);
                  return (
                    <TimelineClip
                      key={entry.clip.id}
                      entry={entry}
                      asset={assetsById[entry.clip.assetId] ?? null}
                      status={assetStatus[entry.clip.assetId] ?? "ready"}
                      selected={entry.clip.id === selectedClipId}
                      pxPerSecond={pxPerSecond}
                      inView={isInView(startPx, endPx, scrollLeft, viewportWidth)}
                      onPointerDown={startDrag}
                    />
                  );
                })}
              </div>
              <div className="editor-timeline-overlays" aria-label={t("editor.timeline.overlays")}>
                {overlays.map((overlay) => {
                  const startPx = usToPx(overlay.startUs, pxPerSecond);
                  const endPx = usToPx(overlay.endUs, pxPerSecond);
                  const label =
                    overlay.kind === "text"
                      ? overlay.text.split("\n")[0]
                      : (assetsById[overlay.assetId]?.filename ?? "");
                  return (
                    <button
                      key={overlay.id}
                      type="button"
                      data-overlay-id={overlay.id}
                      className={`timeline-overlay${overlay.id === selectedOverlayId ? " is-selected" : ""}`}
                      style={{ left: startPx, width: Math.max(12, endPx - startPx) }}
                      title={label}
                      onClick={() => useEditorSession.getState().selectOverlay(overlay.id)}
                      onPointerDown={(event) => startOverlayDrag(overlay, "move", event)}
                    >
                      <span className="timeline-overlay-label">{label}</span>
                      <span
                        className="timeline-handle timeline-handle--start"
                        aria-hidden
                        onPointerDown={(event) => startOverlayDrag(overlay, "start", event)}
                      />
                      <span
                        className="timeline-handle timeline-handle--end"
                        aria-hidden
                        onPointerDown={(event) => startOverlayDrag(overlay, "end", event)}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="editor-hover-line" ref={hoverLineRef} aria-hidden />
              {dropPx == null ? null : (
                <div className="editor-drop-marker" style={{ left: dropPx }} aria-hidden />
              )}
              <PlayheadMarker pxPerSecond={pxPerSecond} />
            </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className="ui-dropdown-content editor-context-menu">
              <ContextMenu.Item
                className="ui-dropdown-item"
                disabled={layout.length === 0}
                onSelect={onSplit}
              >
                <Scissors size={14} strokeWidth={1.75} />
                {t("editor.split")}
                <kbd className="editor-menu-shortcut">S</kbd>
              </ContextMenu.Item>
              <ContextMenu.Item
                className="ui-dropdown-item"
                disabled={!selectedClipId}
                onSelect={onDuplicate}
              >
                <Copy size={14} strokeWidth={1.75} />
                {t("editor.duplicate")}
                <kbd className="editor-menu-shortcut">D</kbd>
              </ContextMenu.Item>
              <ContextMenu.Separator className="ui-dropdown-separator" />
              <ContextMenu.Item
                className="ui-dropdown-item"
                disabled={!selectedClipId && !selectedOverlayId}
                onSelect={onDelete}
              >
                <Trash2 size={14} strokeWidth={1.75} />
                {t("editor.delete")}
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </div>
    </section>
  );
}
