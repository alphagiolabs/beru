import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  ScanEye,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { fmtTime } from "../../utils/video-utils";
import { resolvedDuration, MIN_ZOOM, MAX_ZOOM } from "./utils";
import VideoTimeline from "./VideoTimeline";

/** Bottom player chrome: timeline + transport/zoom controls. */
export default function VideoControls({
  t,
  videoRef,
  playing,
  muted,
  setMuted,
  showTimeline,
  setShowTimeline,
  duration,
  currentTime,
  setCurrentTime,
  setSeeking,
  seekTo,
  operations,
  sel,
  ffmpegPreviewLoading,
  showFfmpegPreview,
  onRenderPreviewFrame,
  isSplitCompare,
  zoom,
  zoomIn,
  zoomOut,
  zoomReset,
}) {
  const seekFrac = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-30"
      style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.85))", paddingTop: "24px" }}
    >
      <VideoTimeline
        showTimeline={showTimeline}
        duration={duration}
        currentTime={currentTime}
        operations={operations}
        seekFrac={seekFrac}
        setSeeking={setSeeking}
        setCurrentTime={setCurrentTime}
        seekTo={seekTo}
      />
      <div className="flex items-center gap-2 px-3 pb-2">
        <button
          onClick={() => {
            const v = videoRef.current;
            if (v) v.currentTime = 0;
          }}
          className="p-1 rounded hover:bg-white/10"
          style={{ color: "var(--text-dim)" }}
          title={t("preview.jumpStart")}
          aria-label={t("preview.jumpStart")}
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) v.play();
            else v.pause();
          }}
          className="p-1.5 rounded-full hover:bg-white/15"
          style={{ color: "var(--accent)" }}
          title={t("preview.playPause")}
          aria-label={t("preview.playPause")}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          onClick={() => {
            const v = videoRef.current;
            const d = resolvedDuration(v, sel?.duration);
            if (v && d) v.currentTime = d;
          }}
          className="p-1 rounded hover:bg-white/10"
          style={{ color: "var(--text-dim)" }}
          title={t("preview.jumpEnd")}
          aria-label={t("preview.jumpEnd")}
        >
          <SkipForward size={14} />
        </button>
        <button
          onClick={() => {
            const v = videoRef.current;
            if (v) {
              v.muted = !v.muted;
              setMuted(v.muted);
            }
          }}
          className="p-1 rounded hover:bg-white/10"
          style={{ color: "var(--text-dim)" }}
          title={muted ? t("preview.unmute") : t("preview.mute")}
          aria-label={muted ? t("preview.unmute") : t("preview.mute")}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <button
          onClick={() => setShowTimeline((v) => !v)}
          className="p-1 rounded hover:bg-white/10"
          style={{ color: showTimeline ? "var(--accent)" : "var(--text-dim)" }}
          title={showTimeline ? t("preview.hideTimeline") : t("preview.showTimeline")}
          aria-label={showTimeline ? t("preview.hideTimeline") : t("preview.showTimeline")}
        >
          {showTimeline ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          onClick={onRenderPreviewFrame}
          disabled={ffmpegPreviewLoading}
          className="p-1 rounded hover:bg-white/10 disabled:opacity-40"
          style={{
            color: showFfmpegPreview ? "var(--accent)" : "var(--text-dim)",
          }}
          title={t("preview.renderFrame")}
          aria-label={t("preview.renderFrame")}
        >
          {ffmpegPreviewLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ScanEye size={14} />
          )}
        </button>
        <span className="text-[10px] font-mono ml-1" style={{ color: "var(--text-secondary)" }}>
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </span>
        <div className="flex-1" />
        {!isSplitCompare && (
          <div
            className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-white/10 shadow-sm backdrop-blur-md transition-all"
            style={{ background: "rgba(0,0,0,0.5)" }}
          >
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="p-1 rounded hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:active:scale-100 transition-all"
              style={{ color: "var(--text-secondary, #a3a3a3)" }}
              title={t("preview.zoomOut")}
              aria-label={t("preview.zoomOut")}
            >
              <ZoomOut size={14} />
            </button>
            <div className="w-[1px] h-3 bg-white/10 mx-0.5"></div>
            <button
              type="button"
              onClick={zoomReset}
              className="px-2 py-0.5 rounded text-[10px] font-mono hover:bg-white/10 active:scale-95 transition-all min-w-[48px] text-center font-medium"
              style={{ color: zoom > 1 ? "var(--accent)" : "var(--text-secondary, #a3a3a3)" }}
              title={t("preview.zoomReset")}
              aria-label={t("preview.zoomReset")}
            >
              {Math.round(zoom * 100)}%
            </button>
            <div className="w-[1px] h-3 bg-white/10 mx-0.5"></div>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="p-1 rounded hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:active:scale-100 transition-all"
              style={{ color: "var(--text-secondary, #a3a3a3)" }}
              title={t("preview.zoomIn")}
              aria-label={t("preview.zoomIn")}
            >
              <ZoomIn size={14} />
            </button>
          </div>
        )}
        <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)" }}>
          {sel.width}×{sel.height}
        </span>
      </div>
    </div>
  );
}
