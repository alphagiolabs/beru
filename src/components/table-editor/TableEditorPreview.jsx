import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import TextOverlay from "../TextOverlay";
import { regionToScreen, fmtTime } from "../../utils/video-utils";
import { useT } from "../../i18n/useT";

export default function TableEditorPreview({
  videoRef,
  focusedVideo,
  focused,
  templateRegions,
  focusedOp,
  playing,
  currentTime,
  duration,
  setSeeking,
  seekTo,
  setCurrentTime,
  getBatchPreviewPayload,
}) {
  const t = useT();
  const seekFrac = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="te-preview">
      <div className="te-stage">
        {focusedVideo ? (
          <div className="te-stage-frame">
            <video
              ref={videoRef}
              src={focusedVideo.src || null}
              className="te-video"
              preload="metadata"
            />
            {templateRegions.map((tr) => {
              const payload = getBatchPreviewPayload(focused.videoIdx, tr.id);
              if (!payload) return null;
              const s = regionToScreen(payload.region, videoRef.current);
              if (!s) return null;
              const isCellFocused = focused.regionId === tr.id;
              return (
                <TextOverlay
                  key={tr.id}
                  screen={s}
                  text={payload.text}
                  style={isCellFocused && focusedOp ? focusedOp : payload.style}
                  isFocused={isCellFocused}
                  showOutline
                  label={
                    isCellFocused && !payload.text ? `${tr.label} (${t("table.empty")})` : undefined
                  }
                  dimmed={!isCellFocused}
                />
              );
            })}
          </div>
        ) : (
          <div className="te-stage-empty">{t("table.noVideo")}</div>
        )}
      </div>

      {focusedVideo && (
        <div className="te-transport">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={seekFrac}
            disabled={duration <= 0}
            aria-label={t("table.seek")}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setSeeking(true);
            }}
            onPointerUp={() => setSeeking(false)}
            onPointerCancel={() => setSeeking(false)}
            onChange={(e) => {
              const frac = parseFloat(e.target.value);
              if (duration <= 0) return;
              setCurrentTime(frac * duration);
              seekTo(frac);
            }}
            className="te-scrub"
            style={{ "--te-seek": `${seekFrac * 100}%` }}
          />
          <div className="te-transport-row">
            <button
              type="button"
              className="te-icon-btn te-icon-btn--sm"
              aria-label={t("table.seekStart")}
              onClick={() => {
                const v = videoRef.current;
                if (v) v.currentTime = 0;
              }}
            >
              <SkipBack size={13} />
            </button>
            <button
              type="button"
              className="te-icon-btn te-icon-btn--sm te-icon-btn--accent"
              aria-label={playing ? t("table.pause") : t("table.play")}
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) v.play();
                else v.pause();
              }}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button
              type="button"
              className="te-icon-btn te-icon-btn--sm"
              aria-label={t("table.seekEnd")}
              onClick={() => {
                const v = videoRef.current;
                if (v && duration > 0) v.currentTime = duration;
              }}
            >
              <SkipForward size={13} />
            </button>
            <span className="te-time">
              {fmtTime(currentTime)}
              <span className="te-time-sep">/</span>
              {fmtTime(duration)}
            </span>
            <span className="te-file" title={focusedVideo.filename}>
              {focusedVideo.filename}
              {focusedVideo.width > 0 ? ` · ${focusedVideo.width}×${focusedVideo.height}` : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
