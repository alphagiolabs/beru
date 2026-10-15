import { Trash2 } from "lucide-react";
import { useT } from "../../i18n/useT";
import { Select } from "../../components/ui/select";
import {
  OVERLAY_TEXT_MAX_LENGTH,
  TEXT_ALIGNS,
  TEXT_FONT_FAMILIES,
  normalizeOverlayStyle,
} from "../../../shared/overlay-style.js";
import DraftField from "./DraftField.jsx";
import { secondsToUs, usToSeconds } from "./editor-model.js";

export default function OverlayInspector({ overlay, asset, onUpdate, onRemove }) {
  const t = useT();
  const style = normalizeOverlayStyle(overlay.style);
  const setStyle = (patch) => onUpdate({ style: patch });
  return (
    <section className="editor-inspector" aria-label={t("editor.inspector.overlayTitle")}>
      <div className="editor-inspector-row">
        <span className="editor-inspector-label">
          {overlay.kind === "text" ? t("editor.overlay.kindText") : asset?.filename}
        </span>
        <button type="button" className="editor-button" onClick={onRemove}>
          <Trash2 size={14} strokeWidth={1.75} />
          {t("editor.overlay.remove")}
        </button>
      </div>

      <div className="editor-inspector-row editor-range">
        <DraftField
          label={t("editor.rangeStart")}
          value={usToSeconds(overlay.startUs).toFixed(2)}
          min={0}
          step={0.01}
          onCommit={(seconds) => onUpdate({ startUs: secondsToUs(seconds) })}
        />
        <DraftField
          label={t("editor.rangeEnd")}
          value={usToSeconds(overlay.endUs).toFixed(2)}
          min={0}
          step={0.01}
          onCommit={(seconds) => onUpdate({ endUs: secondsToUs(seconds) })}
        />
      </div>

      {overlay.kind === "text" ? (
        <>
          <div className="editor-inspector-row editor-overlay-style">
            <DraftField
              key={overlay.id}
              type="text"
              label={t("editor.overlay.text")}
              value={overlay.text}
              maxLength={OVERLAY_TEXT_MAX_LENGTH}
              onCommit={(text) => {
                if (text.trim().length > 0) onUpdate({ text });
              }}
            />
            <DraftField
              label={t("editor.overlay.size")}
              value={(style.size * 100).toFixed(1)}
              min={1}
              max={50}
              step={0.5}
              onCommit={(percent) => setStyle({ size: percent / 100 })}
            />
            <DraftField
              label={t("editor.overlay.color")}
              type="color"
              value={style.color}
              onCommit={(color) => setStyle({ color })}
            />
          </div>

          <div className="editor-inspector-row editor-overlay-style">
            <Select
              size="sm"
              value={style.fontFamily}
              onValueChange={(fontFamily) => setStyle({ fontFamily })}
              aria-label={t("editor.overlay.font")}
              options={TEXT_FONT_FAMILIES.map((family) => ({ value: family, label: family }))}
            />
            <button
              type="button"
              className="editor-button"
              aria-pressed={style.bold}
              onClick={() => setStyle({ bold: !style.bold })}
            >
              {t("editor.overlay.bold")}
            </button>
            <button
              type="button"
              className="editor-button"
              aria-pressed={style.italic}
              onClick={() => setStyle({ italic: !style.italic })}
            >
              {t("editor.overlay.italic")}
            </button>
            <Select
              size="sm"
              value={style.textAlign}
              onValueChange={(textAlign) => setStyle({ textAlign })}
              aria-label={t("editor.overlay.align")}
              options={TEXT_ALIGNS.map((align) => ({
                value: align,
                label: t(`editor.overlay.align.${align}`),
              }))}
            />
          </div>

          <div className="editor-inspector-row editor-overlay-style">
            <DraftField
              label={t("editor.overlay.opacity")}
              value={(style.textOpacity * 100).toFixed(0)}
              min={0}
              max={100}
              step={1}
              onCommit={(percent) => setStyle({ textOpacity: percent / 100 })}
            />
            <DraftField
              label={t("editor.overlay.outline")}
              value={(style.borderWidth * 100).toFixed(1)}
              min={0}
              max={25}
              step={0.5}
              onCommit={(percent) => setStyle({ borderWidth: percent / 100 })}
            />
            <DraftField
              label={t("editor.overlay.outlineColor")}
              type="color"
              value={style.borderColor}
              onCommit={(borderColor) => setStyle({ borderColor })}
            />
          </div>

          <div className="editor-inspector-row editor-overlay-style">
            <button
              type="button"
              className="editor-button"
              aria-pressed={style.textShadowEnabled}
              onClick={() => setStyle({ textShadowEnabled: !style.textShadowEnabled })}
            >
              {t("editor.overlay.shadow")}
            </button>
            <DraftField
              label={t("editor.overlay.shadowColor")}
              type="color"
              value={style.textShadowColor}
              onCommit={(textShadowColor) => setStyle({ textShadowColor })}
            />
          </div>

          <div className="editor-inspector-row editor-overlay-style">
            <button
              type="button"
              className="editor-button"
              aria-pressed={style.bgEnabled}
              onClick={() => setStyle({ bgEnabled: !style.bgEnabled })}
            >
              {t("editor.overlay.background")}
            </button>
            <DraftField
              label={t("editor.overlay.backgroundColor")}
              type="color"
              value={style.bgColor}
              onCommit={(bgColor) => setStyle({ bgColor })}
            />
            <DraftField
              label={t("editor.overlay.backgroundOpacity")}
              value={(style.bgOpacity * 100).toFixed(0)}
              min={0}
              max={100}
              step={1}
              onCommit={(percent) => setStyle({ bgOpacity: percent / 100 })}
            />
          </div>
        </>
      ) : null}

      <div className="editor-inspector-row editor-crop">
        <span className="editor-inspector-label">{t("editor.overlay.box")}</span>
        {["x", "y", "w", "h"].map((key) => (
          <DraftField
            key={key}
            label={key}
            value={overlay.geometry[key].toFixed(2)}
            min={0}
            max={1}
            step={0.01}
            onCommit={(next) => onUpdate({ geometry: { [key]: next } })}
          />
        ))}
      </div>
    </section>
  );
}
