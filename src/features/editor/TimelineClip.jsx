import useFilmstripFrames from "../../components/video-preview/useFilmstripFrames";
import { usToPx } from "./timeline/geometry.js";
import { usToSeconds } from "./editor-model.js";

const MIN_CLIP_PX = 4;
const MAX_FRAMES = 20;

function TimelineClip({ entry, asset, status, selected, pxPerSecond, inView, onPointerDown }) {
  const sourceSeconds = usToSeconds(entry.clip.sourceOutUs - entry.clip.sourceInUs);
  const frameCount = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(sourceSeconds / 2)));
  const ready = inView && status === "ready" && asset;
  const { frames } = useFilmstripFrames(
    ready ? asset.path : null,
    ready ? sourceSeconds : 0,
    frameCount,
    {
      start: usToSeconds(entry.clip.sourceInUs),
      owner: `clip:${entry.clip.id}`,
    },
  );
  const left = usToPx(entry.startUs, pxPerSecond);
  const width = Math.max(MIN_CLIP_PX, usToPx(entry.endUs - entry.startUs, pxPerSecond));
  const classes = ["timeline-clip"];
  if (selected) classes.push("is-selected");
  if (status !== "ready") classes.push("is-missing");

  return (
    <div
      className={classes.join(" ")}
      style={{ left, width }}
      data-clip-id={entry.clip.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={asset?.filename ?? ""}
      onPointerDown={(event) => onPointerDown(entry, "move", event)}
    >
      <div className="timeline-clip-frames" aria-hidden>
        {frames.map((src, index) =>
          src ? (
            <img key={index} src={src} alt="" draggable={false} />
          ) : (
            <span key={index} className="timeline-clip-frame-empty" />
          ),
        )}
      </div>
      <span className="timeline-clip-label">{asset?.filename}</span>
      <span
        className="timeline-handle timeline-handle--start"
        aria-hidden
        onPointerDown={(event) => {
          event.stopPropagation();
          onPointerDown(entry, "trim-start", event);
        }}
      />
      <span
        className="timeline-handle timeline-handle--end"
        aria-hidden
        onPointerDown={(event) => {
          event.stopPropagation();
          onPointerDown(entry, "trim-end", event);
        }}
      />
    </div>
  );
}

export default TimelineClip;
