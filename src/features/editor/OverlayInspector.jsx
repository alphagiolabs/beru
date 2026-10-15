import { Trash2 } from "lucide-react";
import { useT } from "../../i18n/useT";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/select";
import { InspectorGroup } from "../../components/inspector";
import {
  OVERLAY_TEXT_MAX_LENGTH,
  TEXT_ALIGNS,
  TEXT_FONT_FAMILIES,
  normalizeOverlayStyle,
} from "../../../shared/overlay-style.js";
import DraftField from "./DraftField.jsx";
import InspectorTabs from "./InspectorTabs.jsx";
import { secondsToUs, usToSeconds } from "./editor-model.js";

function Chip({ pressed, onToggle, children }) {
  return (
    <button
      type="button"
      className={`inspector-chip${pressed ? " is-selected" : ""}`}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}

export default function OverlayInspector({ overlay, asset, onUpdate, onRemove }) {
  const t = useT();
  const style = normalizeOverlayStyle(overlay.style);
  const setStyle = (patch) => onUpdate({ style: patch });

  const range = (
    <InspectorGroup title={t("editor.range")}>
      <div className="editor-range editor-grid-2">
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
    </InspectorGroup>
  );

  const box = (
    <InspectorGroup title={t("editor.overlay.box")}>
      <div className="editor-grid-4">
        {["x", "y", "w", "h"].map((key) => (
          <DraftField
            key={key}
            label={key.toUpperCase()}
            value={overlay.geometry[key].toFixed(2)}
            min={0}
            max={1}
            step={0.01}
            onCommit={(next) => onUpdate({ geometry: { [key]: next } })}
          />
        ))}
      </div>
    </InspectorGroup>
  );

  const text = (
    <InspectorGroup>
      <div className="editor-overlay-style">
        <DraftField
          key={overlay.id}
          type="text"
          label={t("editor.overlay.text")}
          value={overlay.text}
          maxLength={OVERLAY_TEXT_MAX_LENGTH}
          onCommit={(next) => {
            if (next.trim().length > 0) onUpdate({ text: next });
          }}
        />
      </div>
      <Select
        size="sm"
        value={style.fontFamily}
        onValueChange={(fontFamily) => setStyle({ fontFamily })}
        aria-label={t("editor.overlay.font")}
        options={TEXT_FONT_FAMILIES.map((family) => ({ value: family, label: family }))}
      />
      <div className="editor-grid-2">
        <DraftField
          label={t("editor.overlay.size")}
          value={(style.size * 100).toFixed(1)}
          min={1}
          max={50}
          step={0.5}
          onCommit={(percent) => setStyle({ size: percent / 100 })}
        />
        <DraftField
          label={t("editor.overlay.opacity")}
          value={(style.textOpacity * 100).toFixed(0)}
          min={0}
          max={100}
          step={1}
          onCommit={(percent) => setStyle({ textOpacity: percent / 100 })}
        />
      </div>
      <div className="editor-style-row">
        <Chip pressed={style.bold} onToggle={() => setStyle({ bold: !style.bold })}>
          {t("editor.overlay.bold")}
        </Chip>
        <Chip pressed={style.italic} onToggle={() => setStyle({ italic: !style.italic })}>
          {t("editor.overlay.italic")}
        </Chip>
        <DraftField
          label={t("editor.overlay.color")}
          type="color"
          value={style.color}
          onCommit={(color) => setStyle({ color })}
        />
      </div>
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
    </InspectorGroup>
  );

  const textStyle = (
    <InspectorGroup>
      <div className="editor-style-row">
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
      <div className="editor-style-row">
        <Chip
          pressed={style.textShadowEnabled}
          onToggle={() => setStyle({ textShadowEnabled: !style.textShadowEnabled })}
        >
          {t("editor.overlay.shadow")}
        </Chip>
        <DraftField
          label={t("editor.overlay.shadowColor")}
          type="color"
          value={style.textShadowColor}
          onCommit={(textShadowColor) => setStyle({ textShadowColor })}
        />
      </div>
      <div className="editor-style-row">
        <Chip pressed={style.bgEnabled} onToggle={() => setStyle({ bgEnabled: !style.bgEnabled })}>
          {t("editor.overlay.background")}
        </Chip>
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
    </InspectorGroup>
  );

  const tabs =
    overlay.kind === "text"
      ? [
          {
            id: "text",
            label: t("editor.overlay.text"),
            content: (
              <>
                {range}
                {text}
              </>
            ),
          },
          { id: "style", label: t("editor.overlay.style"), content: textStyle },
          { id: "position", label: t("editor.tab.position"), content: box },
        ]
      : [
          {
            id: "basic",
            label: t("editor.tab.basic"),
            content: (
              <>
                {range}
                {box}
              </>
            ),
          },
        ];

  return (
    <section className="editor-inspector" aria-label={t("editor.inspector.overlayTitle")}>
      <header className="editor-side-head">
        <h2>{overlay.kind === "text" ? t("editor.overlay.kindText") : asset?.filename}</h2>
        <Button variant="tertiary" size="sm" onClick={onRemove}>
          <Trash2 size={14} strokeWidth={1.75} />
          {t("editor.overlay.remove")}
        </Button>
      </header>
      <InspectorTabs label={t("editor.inspector.overlayTitle")} tabs={tabs} />
    </section>
  );
}
