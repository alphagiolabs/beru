import { useEffect, useRef, useState } from "react";
import { ImagePlus, Type } from "lucide-react";
import { useT } from "../../i18n/useT";
import { trimClip } from "../../../shared/editor-timeline.js";
import TimelineClip from "./TimelineClip.jsx";
import { formatClock, usToSeconds } from "./editor-model.js";
import { useEditorSession } from "./store/useEditorSession.js";
import {
  beginTimelineGesture,
  cancelTimelineGesture,
  endTimelineGesture,
  previewClipOperation,
  previewMoveClip,
} from "./editor-actions.js";
import {
  dropIndex,
  fitPxPerSecond,
  isInView,
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
}) {
  const t = useT();
  const pxPerSecond = useEditorSession((s) => s.pxPerSecond);
  const selectedClipId = useEditorSession((s) => s.selectedClipId);
  const selectedOverlayId = useEditorSession((s) => s.selectedOverlayId);
  const playhead = useEditorSession((s) => s.playhead);
  const playing = useEditorSession((s) => s.playing);
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const drag = useRef(null);
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

  const onTrackPointerDown = (event) => {
    if (event.button !== 0 || drag.current) return;
    if (event.target.closest?.(".timeline-clip, .timeline-overlay")) return;
    drag.current = { mode: "scrub", startX: event.clientX, moved: true };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrubTo(timeAt(event.clientX));
  };

  const onTrackPointerMove = (event) => {
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

  const zoomBy = (factor) => useEditorSession.getState().setZoom(pxPerSecond * factor);
  const fitZoom = () =>
    useEditorSession.getState().setZoom(fitPxPerSecond(duration, viewportWidth - 32));

  return (
    <section className="editor-timeline" aria-label={t("editor.timeline.title")}>
      <header className="editor-timeline-head">
        <strong>{t("editor.timeline.title")}</strong>
        <span className="editor-muted">{formatClock(totalSeconds)}</span>
        <span className="editor-spacer" />
        <button type="button" className="editor-button" onClick={onAddTitle}>
          <Type size={14} strokeWidth={1.75} />
          {t("editor.addTitle")}
        </button>
        <button type="button" className="editor-button" onClick={onAddImage}>
          <ImagePlus size={14} strokeWidth={1.75} />
          {t("editor.addImage")}
        </button>
        <button
          type="button"
          className="editor-button"
          onClick={() => zoomBy(1 / 1.5)}
          aria-label={t("editor.timeline.zoomOut")}
        >
          −
        </button>
        <button type="button" className="editor-button" onClick={fitZoom}>
          {t("editor.timeline.fit")}
        </button>
        <button
          type="button"
          className="editor-button"
          onClick={() => zoomBy(1.5)}
          aria-label={t("editor.timeline.zoomIn")}
        >
          +
        </button>
      </header>
      <div
        className="editor-timeline-viewport"
        ref={viewportRef}
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
      >
        {layout.length === 0 ? (
          <p className="editor-muted editor-timeline-empty">{t("editor.timeline.empty")}</p>
        ) : null}
        <div
          className="editor-timeline-track"
          ref={trackRef}
          style={{ width: trackWidth }}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
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
                  className={`timeline-overlay${overlay.id === selectedOverlayId ? " is-selected" : ""}`}
                  style={{ left: startPx, width: Math.max(12, endPx - startPx) }}
                  title={label}
                  onClick={() => useEditorSession.getState().selectOverlay(overlay.id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <PlayheadMarker pxPerSecond={pxPerSecond} />
        </div>
      </div>
    </section>
  );
}
