import { Play, Pause, SkipBack, SkipForward, FileVideo } from "lucide-react";
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
    <div className="table-editor-preview">
      <div className="table-editor-section-label">{t("table.preview")}</div>

      <div className="table-editor-stage">
        {focusedVideo ? (
          <div className="relative inline-block" style={{ maxWidth: "100%", maxHeight: "100%" }}>
            <video
              ref={videoRef}
              src={focusedVideo.src || null}
              className="max-h-full max-w-full block object-contain"
              style={{ maxHeight: "calc(90vh - 380px)" }}
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
                  label={isCellFocused && !payload.text ? `${tr.label} (${t("table.empty")})` : undefined}
                  dimmed={!isCellFocused}
                />
              );
            })}
          </div>
        ) : (
          <div className="table-editor-stage-empty">{t("table.noVideo")}</div>
        )}
      </div>

      {focusedVideo && (
        <div className="table-editor-transport">
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
            className="table-editor-scrub"
            style={{ "--te-seek": `${seekFrac * 100}%` }}
          />

          <div className="table-editor-transport-row">
            <button
              type="button"
              className="table-editor-transport-btn"
              aria-label={t("table.seekStart")}
              title={t("table.seekStart")}
              onClick={() => {
                const v = videoRef.current;
                if (v) v.currentTime = 0;
              }}
            >
              <SkipBack size={13} />
            </button>
            <button
              type="button"
              className="table-editor-transport-btn table-editor-transport-btn--primary"
              aria-label={playing ? t("table.pause") : t("table.play")}
              title={playing ? t("table.pause") : t("table.play")}
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
              className="table-editor-transport-btn"
              aria-label={t("table.seekEnd")}
              title={t("table.seekEnd")}
              onClick={() => {
                const v = videoRef.current;
                if (v && duration > 0) v.currentTime = duration;
              }}
            >
              <SkipForward size={13} />
            </button>

            <span className="table-editor-time">
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>

            <div className="table-editor-file-meta">
              <FileVideo size={11} aria-hidden />
              <span className="table-editor-file-name" title={focusedVideo.filename}>
                {focusedVideo.filename}
              </span>
              {focusedVideo.width > 0 && (
                <span className="table-editor-time">
                  {focusedVideo.width}×{focusedVideo.height}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
