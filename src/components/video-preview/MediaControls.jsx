import { useState } from "react";
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
} from "lucide-react";
import { Button } from "../ui/Button";
import { useT } from "../../i18n/useT";
import { fmtTime } from "../../utils/video-utils";
import { isOpActive } from "../../utils/operation";
import { opModeColor } from "./utils";
import useVideoControls from "./useVideoControls";

export default function MediaControls({
  videoRef,
  videoKey,
  duration,
  operations = [],
  renderLoading,
  renderActive,
  onToggleRender,
  zoomControls,
  width,
  height,
}) {
  const t = useT();
  const [showTimeline, setShowTimeline] = useState(true);
  const {
    playing,
    currentTime,
    muted,
    seekFrac,
    togglePlay,
    jumpStart,
    jumpEnd,
    toggleMute,
    startScrub,
    scrubTo,
    endScrub,
  } = useVideoControls(videoRef, { duration, videoKey });

  return (
    <div
      className="video-preview-media-controls absolute bottom-0 left-0 right-0 z-30"
      style={{
        background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
        paddingTop: "24px",
      }}
    >
      <div className="px-3 pb-1 relative">
        {showTimeline &&
          duration > 0 &&
          operations.some((op) => op.startTime != null || op.endTime != null) && (
            <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-3 pointer-events-none z-10">
              {operations.map((op) => {
                const s = op.startTime ?? 0;
                const e = op.endTime ?? duration;
                const left = (s / duration) * 100;
                const opWidth = Math.max(0.5, ((e - s) / duration) * 100);
                return (
                  <div
                    key={op.id}
                    className="absolute h-1 rounded-sm"
                    style={{
                      left: `${left}%`,
                      width: `${opWidth}%`,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: opModeColor[op.mode] || "#888",
                      opacity: isOpActive(op, currentTime) ? 0.85 : 0.25,
                    }}
                    title={`${op.mode} ${fmtTime(s)} → ${fmtTime(e)}`}
                  />
                );
              })}
            </div>
          )}
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={seekFrac}
          disabled={duration <= 0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            startScrub();
          }}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onChange={(e) => scrubTo(parseFloat(e.target.value))}
          className="w-full h-1 rounded-full appearance-none cursor-pointer relative z-20"
          style={{
            accentColor: "var(--accent)",
            background: `linear-gradient(to right, var(--accent) ${seekFrac * 100}%, var(--border) ${seekFrac * 100}%)`,
          }}
        />
      </div>
      <div className="flex items-center gap-2 px-3 pb-2" style={{ background: "rgba(0,0,0,0.82)" }}>
        <Button
          type="button"
          variant="tertiary"
          size="icon"
          className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
          onClick={jumpStart}
          style={{ color: "var(--text-dim)" }}
          title={t("preview.jumpStart")}
          aria-label={t("preview.jumpStart")}
        >
          <SkipBack size={14} />
        </Button>
        <Button
          type="button"
          variant="tertiary"
          size="icon"
          className="video-preview-icon-btn video-preview-play-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0 !rounded-full"
          onClick={togglePlay}
          style={{ color: "var(--text-accent)" }}
          title={t("preview.playPause")}
          aria-label={t("preview.playPause")}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </Button>
        <Button
          type="button"
          variant="tertiary"
          size="icon"
          className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
          onClick={jumpEnd}
          style={{ color: "var(--text-dim)" }}
          title={t("preview.jumpEnd")}
          aria-label={t("preview.jumpEnd")}
        >
          <SkipForward size={14} />
        </Button>
        <Button
          type="button"
          variant="tertiary"
          size="icon"
          className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
          onClick={toggleMute}
          style={{ color: "var(--text-dim)" }}
          title={muted ? t("preview.unmute") : t("preview.mute")}
          aria-label={muted ? t("preview.unmute") : t("preview.mute")}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </Button>
        <Button
          type="button"
          variant="tertiary"
          size="icon"
          className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
          onClick={() => setShowTimeline((v) => !v)}
          style={{ color: showTimeline ? "var(--text-accent)" : "var(--text-dim)" }}
          title={showTimeline ? t("preview.hideTimeline") : t("preview.showTimeline")}
          aria-label={showTimeline ? t("preview.hideTimeline") : t("preview.showTimeline")}
        >
          {showTimeline ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>
        <Button
          type="button"
          variant="tertiary"
          size="icon"
          loading={renderLoading}
          onClick={(e) => {
            e.stopPropagation();
            onToggleRender();
          }}
          className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
          style={{
            color: renderActive ? "var(--text-accent)" : "var(--text-dim)",
          }}
          title={renderActive ? t("preview.closeRenderFrame") : t("preview.renderFrame")}
          aria-label={renderActive ? t("preview.closeRenderFrame") : t("preview.renderFrame")}
          aria-pressed={renderActive}
        >
          {!renderLoading && <ScanEye size={14} />}
        </Button>
        <span className="text-[10px] font-mono ml-1" style={{ color: "var(--text-secondary)" }}>
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </span>
        <div className="flex-1" />
        {zoomControls}
        <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)" }}>
          {width}×{height}
        </span>
      </div>
    </div>
  );
}
