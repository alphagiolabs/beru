import { useT } from "../i18n/useT";
import {
  CLOCK_DATE_STYLES,
  CLOCK_FORMATS,
  CLOCK_LAYOUTS,
  clockStartFromDate,
  normalizeClockFields,
  parseClockStart,
} from "../utils/datetime-stamp";
import { InspectorGroup, SegmentedToolbar } from "./inspector";
import { Button } from "./ui/Button";

export default function DateTimeFields({ value, onPatch, onApplyDvrStyle }) {
  const t = useT();
  const clock = { ...normalizeClockFields(value), clockStart: value?.clockStart ?? "" };
  const invalid = parseClockStart(clock.clockStart) == null;
  const segmented = (key, options, labelPrefix) => (
    <SegmentedToolbar
      ariaLabel={t(`${labelPrefix}.label`)}
      value={clock[key]}
      onChange={(next) => onPatch({ [key]: next })}
      options={options.map((option) => ({ value: option, label: t(`${labelPrefix}.${option}`) }))}
    />
  );

  return (
    <InspectorGroup title={t("datetime.title")}>
      <div className="space-y-2.5">
        <label className="block">
          <span className="cap-input-label">{t("datetime.start")}</span>
          <div className="flex gap-1.5">
            <input
              type="datetime-local"
              step={1}
              value={clock.clockStart}
              onChange={(e) => onPatch({ clockStart: e.target.value.replace(/\.\d+$/, "") })}
              className="cap-input font-mono text-[11px] flex-1 min-w-0"
              aria-invalid={invalid}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onPatch({ clockStart: clockStartFromDate(new Date()) })}
            >
              {t("datetime.now")}
            </Button>
          </div>
          <span className="inspector-helper block mt-1">
            {invalid ? t("datetime.invalidStart") : t("datetime.startHint")}
          </span>
        </label>
        {onApplyDvrStyle && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={onApplyDvrStyle}
            title={t("datetime.dvrStyleHint")}
          >
            {t("datetime.dvrStyle")}
          </Button>
        )}
        <div>
          <span className="cap-input-label">{t("datetime.format.label")}</span>
          {segmented("clockFormat", CLOCK_FORMATS, "datetime.format")}
        </div>
        {clock.clockFormat !== "time" && (
          <div>
            <span className="cap-input-label">{t("datetime.dateStyle.label")}</span>
            {segmented("clockDateStyle", CLOCK_DATE_STYLES, "datetime.dateStyle")}
          </div>
        )}
        {clock.clockFormat === "datetime" && (
          <div>
            <span className="cap-input-label">{t("datetime.layout.label")}</span>
            {segmented("clockLayout", CLOCK_LAYOUTS, "datetime.layout")}
          </div>
        )}
      </div>
    </InspectorGroup>
  );
}
