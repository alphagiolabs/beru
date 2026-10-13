import { useEffect, useState } from "react";
import { clipTimeline } from "../../../shared/clip-timeline.js";
import { useT } from "../../i18n/useT";
import useEditorStore from "../../stores/useEditorStore";

export default function PreviewTimingClock({ videoRef, item }) {
  const t = useT();
  const previewCycle = useEditorStore((s) => s.previewCycle);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const video = videoRef.current;
    const sync = () => setTime(video?.currentTime ?? 0);
    sync();
    for (const event of ["timeupdate", "seeked", "loadedmetadata"])
      video?.addEventListener(event, sync);
    return () => {
      for (const event of ["timeupdate", "seeked", "loadedmetadata"])
        video?.removeEventListener(event, sync);
    };
  }, [videoRef, item?.path]);
  const timeline = clipTimeline(item);
  if (timeline.rate === 1 && timeline.repeatCount === 1) return null;
  const output = timeline.sourceToOutput(
    time,
    Math.min(previewCycle ?? 0, timeline.repeatCount - 1),
  );
  return (
    <div
      className="absolute top-2 left-2 z-[26] rounded px-2 py-1 text-[10px] tabular-nums pointer-events-none"
      style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
    >
      <div>{t("timing.sourceClock", { seconds: time.toFixed(2) })}</div>
      <div>
        {output == null
          ? t("timing.outsideTrim")
          : t("timing.outputClock", { seconds: output.toFixed(2) })}
      </div>
    </div>
  );
}
