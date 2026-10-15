import { useT } from "../../i18n/useT";
import { Select } from "../../components/ui/select";
import { normalizeClipTransform } from "../../../shared/clip-transform.js";
import DraftField from "./DraftField.jsx";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const ROTATIONS = [0, 90, 180, 270];

export default function ClipInspector({ entry, onSpeed, onMute, onTransform, onGesture }) {
  const t = useT();
  const clip = entry.clip;
  const transform = normalizeClipTransform(clip.transform);
  const sliderHandlers = {
    onPointerDown: () => onGesture("start"),
    onPointerUp: () => onGesture("end"),
    onPointerCancel: () => onGesture("end"),
  };
  return (
    <section className="editor-inspector" aria-label={t("editor.inspector.title")}>
      <div className="editor-inspector-row">
        <span className="editor-inspector-label">{t("editor.speed")}</span>
        <Select
          size="sm"
          value={String(clip.speed)}
          onValueChange={(value) => onSpeed(Number(value))}
          aria-label={t("editor.speed")}
          options={SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` }))}
        />
        <button
          type="button"
          className="editor-button"
          aria-pressed={clip.muted === true}
          onClick={() => onMute(clip.muted !== true)}
        >
          {clip.muted === true ? t("editor.unmute") : t("editor.mute")}
        </button>
      </div>

      <div className="editor-inspector-row">
        <span className="editor-inspector-label">{t("editor.rotate")}</span>
        {ROTATIONS.map((degrees) => (
          <button
            key={degrees}
            type="button"
            className="editor-button"
            aria-pressed={transform.rotate === degrees}
            onClick={() => onTransform({ rotate: degrees })}
          >
            {degrees}°
          </button>
        ))}
        <button
          type="button"
          className="editor-button"
          aria-pressed={transform.flipH}
          onClick={() => onTransform({ flipH: !transform.flipH })}
        >
          {t("editor.flipH")}
        </button>
        <button
          type="button"
          className="editor-button"
          aria-pressed={transform.flipV}
          onClick={() => onTransform({ flipV: !transform.flipV })}
        >
          {t("editor.flipV")}
        </button>
      </div>

      <div className="editor-inspector-row">
        <Select
          size="sm"
          value={transform.fit}
          onValueChange={(value) => onTransform({ fit: value })}
          aria-label={t("editor.fit")}
          options={[
            { value: "fit", label: t("editor.fitContain") },
            { value: "fill", label: t("editor.fitCover") },
          ]}
        />
        <label className="editor-inspector-slider">
          {t("editor.zoom")} {transform.zoom.toFixed(2)}×
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={transform.zoom}
            {...sliderHandlers}
            onChange={(event) => onTransform({ zoom: Number(event.target.value) }, { live: true })}
          />
        </label>
        <label className="editor-inspector-slider">
          {t("editor.offsetX")}
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={transform.offsetX}
            {...sliderHandlers}
            onChange={(event) =>
              onTransform({ offsetX: Number(event.target.value) }, { live: true })
            }
          />
        </label>
        <label className="editor-inspector-slider">
          {t("editor.offsetY")}
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={transform.offsetY}
            {...sliderHandlers}
            onChange={(event) =>
              onTransform({ offsetY: Number(event.target.value) }, { live: true })
            }
          />
        </label>
      </div>

      <div className="editor-inspector-row editor-crop">
        <span className="editor-inspector-label">{t("editor.crop")}</span>
        {["x", "y", "w", "h"].map((key) => (
          <DraftField
            key={key}
            label={key}
            value={String(transform.crop[key])}
            min={0}
            max={1}
            step={0.01}
            onCommit={(value) => onTransform({ crop: { ...transform.crop, [key]: value } })}
          />
        ))}
      </div>
    </section>
  );
}
