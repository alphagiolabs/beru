import { fmtTime } from "../../utils/video-utils";
import { opModeColor, isOpActive } from "./utils";

/** Seek bar with optional operation time-range markers. Presentational only. */
export default function VideoTimeline({
  showTimeline,
  duration,
  currentTime,
  operations,
  seekFrac,
  setSeeking,
  setCurrentTime,
  seekTo,
}) {
  const hasTimeMarkers =
    showTimeline &&
    duration > 0 &&
    Array.isArray(operations) &&
    operations.some((op) => op.startTime != null || op.endTime != null);

  return (
    <div className="px-3 pb-1 relative">
      {hasTimeMarkers && (
        <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-3 pointer-events-none z-10">
          {operations.map((op) => {
            const s = op.startTime ?? 0;
            const e = op.endTime ?? duration;
            const left = (s / duration) * 100;
            const width = Math.max(0.5, ((e - s) / duration) * 100);
            return (
              <div
                key={op.id}
                className="absolute h-1 rounded-sm"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
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
        className="w-full h-1 rounded-full appearance-none cursor-pointer relative z-20"
        style={{
          accentColor: "var(--accent)",
          background: `linear-gradient(to right, var(--accent) ${seekFrac * 100}%, var(--border) ${seekFrac * 100}%)`,
        }}
      />
    </div>
  );
}
