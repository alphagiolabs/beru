import DraftNumberInput from "./DraftNumberInput";
import { useT } from "../i18n/useT";

export default function TimeRangeFields({ start, end, onStart, onEnd }) {
  const t = useT();
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="cap-input-label">{t("props.startSec")}</span>
          <DraftNumberInput
            value={start ?? ""}
            onCommit={onStart}
            clearable
            step={0.1}
            largeStep={1}
            placeholder="0"
            className="cap-input font-mono text-[11px]"
          />
        </label>
        <label>
          <span className="cap-input-label">{t("props.endSec")}</span>
          <DraftNumberInput
            value={end ?? ""}
            onCommit={onEnd}
            clearable
            step={0.1}
            largeStep={1}
            placeholder={t("logo.endPlaceholder")}
            className="cap-input font-mono text-[11px]"
          />
        </label>
      </div>
      {start != null && end != null && end <= start && (
        <div
          className="cap-card text-[11px] leading-relaxed mt-1"
          style={{ color: "var(--text-rose)", borderColor: "rgba(239,68,68,0.3)" }}
        >
          {t("logo.rangeInvalid")} {t("logo.rangeInvalidHint")}
        </div>
      )}
    </>
  );
}
