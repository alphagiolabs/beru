import { useState } from "react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { InspectorGroup } from "./inspector";
import { Select } from "./ui/select";
import { clipTimeline, playbackRates } from "../../shared/clip-timeline.js";

export default function VideoTimingControls() {
  const t = useT();
  const item = useEditorStore((s) => s.queue[s.selectedIdx]);
  const locked = useEditorStore((s) => s.isProcessing);
  const setTiming = useEditorStore((s) => s.setVideoTiming);
  const previewCycle = useEditorStore((s) => s.previewCycle);
  const setPreviewCycle = useEditorStore((s) => s.setPreviewCycle);
  const [error, setError] = useState(false);
  if (!item) return null;
  const timeline = clipTimeline(item);
  return (
    <InspectorGroup title={t("timing.title")}>
      <label className="block text-[11px] mb-2">
        {t("timing.rate")}
        <Select
          aria-label={t("timing.rate")}
          value={String(timeline.rate)}
          disabled={locked}
          options={playbackRates(timeline.rate).map((rate) => ({
            value: String(rate),
            label: `${rate}×`,
          }))}
          onValueChange={(value) => {
            if (Number(value) !== timeline.rate) setError(!setTiming({ rate: Number(value) }));
          }}
        />
      </label>
      <label className="block text-[11px] mb-2">
        {t("timing.repeat")}
        <Select
          aria-label={t("timing.repeat")}
          value={String(timeline.repeatCount)}
          disabled={locked}
          options={Array.from({ length: 20 }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
          }))}
          onValueChange={(value) => {
            if (Number(value) !== timeline.repeatCount)
              setError(!setTiming({ repeatCount: Number(value) }));
          }}
        />
      </label>
      {timeline.repeatCount > 1 && (
        <label className="block text-[11px] mb-2">
          {t("timing.previewCycle")}
          <Select
            aria-label={t("timing.previewCycle")}
            value={String(Math.min(previewCycle ?? 0, timeline.repeatCount - 1))}
            options={Array.from({ length: timeline.repeatCount }, (_, i) => ({
              value: String(i),
              label: String(i + 1),
            }))}
            onValueChange={(value) => setPreviewCycle(Number(value))}
          />
        </label>
      )}
      <p className="text-[11px] text-[var(--text-secondary)]">
        {t("timing.duration", { seconds: timeline.totalDuration.toFixed(2) })}
      </p>
      {error && (
        <p role="alert" className="text-[11px] mt-2">
          {t("timing.limit")}
        </p>
      )}
    </InspectorGroup>
  );
}
