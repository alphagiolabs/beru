import { Play, Pause, SkipBack, SkipForward, FileVideo } from "lucide-react";
import TextOverlay from "../TextOverlay";
import { regionToScreen, fmtTime } from "../../utils/video-utils";

export default function TableEditorPreview({
  videoRef,
  focusedVideo,
  focused,
  templateRegions,
  focusedOp,
  playing,
  currentTime,
  duration,
  seeking,
  setSeeking,
  seekTo,
  setCurrentTime,
  getBatchPreviewPayload,
}) {
  const seekFrac = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="flex-1 flex flex-col p-3 min-w-0">
      <div className="text-[10px] font-semibold tracking-widest uppercase mb-2" style={{ color: "var(--text-dim)" }}>
        Vista previa
      </div>
      <div className="flex-1 flex items-center justify-center min-h-0 rounded overflow-hidden" style={{ background: "#000" }}>
        {focusedVideo ? (
          <div className="relative inline-block" style={{ maxWidth: "100%", maxHeight: "100%" }}>
            <video
              ref={videoRef}
              src={focusedVideo.src}
              className="max-h-full max-w-full block object-contain"
              style={{ maxHeight: "calc(90vh - 380px)" }}
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
                  label={isCellFocused && !payload.text ? `${tr.label} (vacío)` : undefined}
                  dimmed={!isCellFocused}
                />
              );
            })}
          </div>
        ) : (
          <div className="text-[11px]" style={{ color: "var(--text-dim)" }}>Sin video</div>
        )}
      </div>
      {focusedVideo && (
        <div className="mt-2 flex-shrink-0">
          <input
            type="range" min={0} max={1} step={0.001}
            value={seekFrac}
            onMouseDown={() => setSeeking(true)}
            onMouseUp={() => setSeeking(false)}
            onChange={(e) => {
              const frac = parseFloat(e.target.value);
              setCurrentTime(frac * duration);
              seekTo(frac);
            }}
            className="w-full h-1 rounded-full appearance-none cursor-pointer mb-1"
            style={{
              accentColor: "var(--accent)",
              background: `linear-gradient(to right, var(--accent) ${seekFrac * 100}%, var(--border) ${seekFrac * 100}%)`,
            }}
          />
          <div className="flex items-center gap-1.5 mt-1">
            <button
              onClick={() => { const v = videoRef.current; if (v) v.currentTime = 0; }}
              className="p-1 rounded hover:bg-white/10"
              style={{ color: "var(--text-dim)" }}
            >
              <SkipBack size={12} />
            </button>
            <button
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) v.play(); else v.pause();
              }}
              className="p-1 rounded hover:bg-white/10"
              style={{ color: "var(--accent)" }}
            >
              {playing ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              onClick={() => { const v = videoRef.current; if (v && v.duration) v.currentTime = v.duration; }}
              className="p-1 rounded hover:bg-white/10"
              style={{ color: "var(--text-dim)" }}
            >
              <SkipForward size={12} />
            </button>
            <span className="text-[10px] font-mono" style={{ color: "var(--text-secondary)" }}>
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>
            <div className="flex-1" />
            <span className="text-[10px] truncate max-w-[180px]" style={{ color: "var(--text-dim)" }} title={focusedVideo.filename}>
              <FileVideo size={10} className="inline mr-1" />
              {focusedVideo.filename}
            </span>
            {focusedVideo.width > 0 && (
              <span className="text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
                {focusedVideo.width}×{focusedVideo.height}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}