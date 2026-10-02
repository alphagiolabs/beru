import { AlignStartVertical, AlignCenterVertical, AlignEndVertical } from "lucide-react";
import { VERTICAL_ALIGNS, TRUNCATE_MODES } from "../utils/text-layout";
import { useT } from "../i18n/useT";
import { ToggleSwitch, SegmentedToolbar } from "./inspector";

export default function TextLayoutControls({
  values = {},
  onPatch,
  showTextAlign = false,
  textAlignOptions = null,
}) {
  const t = useT();
  const autoFit = !!values.autoFit;
  const lineHeight = values.lineHeight ?? 1.2;
  const verticalAlign = values.verticalAlign || "top";
  const textWrap = values.textWrap !== false;
  const safeMargin = values.safeMargin ?? 4;
  const truncate = values.truncate || "none";
  const textAlign = values.textAlign || "left";

  const patch = (next) => {
    onPatch?.(next);
  };

  return (
    <div className="inspector-paragraph">
      <div className={`inspector-paragraph-aligns${showTextAlign ? " has-h" : ""}`}>
        {showTextAlign && textAlignOptions ? (
          <div className="inspector-paragraph-align-block">
            <span className="inspector-paragraph-micro">{t("props.horizontal")}</span>
            <SegmentedToolbar
              ariaLabel={t("props.horizontalAlign")}
              columns={3}
              value={textAlign}
              onChange={(value) => patch({ textAlign: value })}
              options={textAlignOptions}
            />
          </div>
        ) : null}

        <div className="inspector-paragraph-align-block">
          <span className="inspector-paragraph-micro">{t("props.vertical")}</span>
          <SegmentedToolbar
            ariaLabel={t("props.verticalAlign")}
            columns={3}
            value={verticalAlign}
            onChange={(value) => patch({ verticalAlign: value })}
            options={VERTICAL_ALIGNS.map((a) => ({
              value: a.value,
              title: t(`position.${a.value}`),
              icon:
                a.value === "top" ? (
                  <AlignStartVertical size={12} />
                ) : a.value === "center" ? (
                  <AlignCenterVertical size={12} />
                ) : (
                  <AlignEndVertical size={12} />
                ),
            }))}
          />
        </div>
      </div>

      <div
        className="inspector-paragraph-metrics"
        role="group"
        aria-label={t("props.paragraphMetrics")}
      >
        <label className="inspector-paragraph-metric">
          <span className="inspector-paragraph-metric-key">{t("props.lineAbbr")}</span>
          <input
            type="number"
            inputMode="decimal"
            aria-label={t("props.lineHeight")}
            value={lineHeight}
            onChange={(e) => patch({ lineHeight: Number(e.target.value) })}
            className="inspector-paragraph-metric-input"
            min={0.8}
            max={3}
            step={0.05}
          />
        </label>
        <label className="inspector-paragraph-metric">
          <span className="inspector-paragraph-metric-key">{t("props.marginAbbr")}</span>
          <input
            type="number"
            inputMode="numeric"
            aria-label={t("props.safeMargin")}
            value={safeMargin}
            onChange={(e) => patch({ safeMargin: Number(e.target.value) })}
            className="inspector-paragraph-metric-input"
            min={0}
            max={48}
          />
        </label>
      </div>

      <div className="inspector-paragraph-list">
        <ToggleSwitch
          label={t("props.autoFit")}
          checked={autoFit}
          onChange={(next) => patch({ autoFit: next })}
        />
        <ToggleSwitch
          label={t("props.lineWrap")}
          checked={textWrap}
          onChange={(next) => patch({ textWrap: next })}
        />
      </div>

      <div className={`inspector-paragraph-truncate${autoFit ? " is-disabled" : ""}`}>
        <span className="inspector-paragraph-micro">{t("props.truncate")}</span>
        <SegmentedToolbar
          ariaLabel={t("props.truncate")}
          columns={3}
          value={truncate}
          disabled={autoFit}
          onChange={(value) => patch({ truncate: value })}
          options={TRUNCATE_MODES.map((m) => ({
            value: m.value,
            label: t(m.labelKey),
            title: t(m.titleKey),
            ariaLabel: t(m.titleKey),
          }))}
        />
      </div>

      {autoFit ? (
        <p className="inspector-helper inspector-paragraph-hint">{t("logo.blurDurationHint")}</p>
      ) : null}
    </div>
  );
}
