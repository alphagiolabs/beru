import { useT } from "../../i18n/useT";
import { Select } from "../../components/ui/select";
import { InspectorGroup, SegmentedToolbar, ToggleSwitch } from "../../components/inspector";
import { normalizeClipTransform } from "../../../shared/clip-transform.js";
import DraftField from "./DraftField.jsx";
import InspectorTabs from "./InspectorTabs.jsx";
import { usToSeconds } from "./editor-model.js";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const ROTATIONS = [0, 90, 180, 270];

function Slider({ label, value, display, min, max, step, gesture, onChange }) {
  return (
    <label className="editor-slider">
      <span className="editor-slider-head">
        <span>{label}</span>
        <output>{display}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        {...gesture}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function ClipInspector({
  entry,
  asset,
  onCommitRange,
  onSpeed,
  onMute,
  onTransform,
  onGesture,
}) {
  const t = useT();
  const clip = entry.clip;
  const transform = normalizeClipTransform(clip.transform);
  const inS = usToSeconds(clip.sourceInUs);
  const outS = usToSeconds(clip.sourceOutUs);
  const gesture = {
    onPointerDown: () => onGesture("start"),
    onPointerUp: () => onGesture("end"),
    onPointerCancel: () => onGesture("end"),
  };
  const live = (key) => (value) => onTransform({ [key]: value }, { live: true });
  const flip = (key, label) => (
    <button
      type="button"
      className={`inspector-chip${transform[key] ? " is-selected" : ""}`}
      aria-pressed={transform[key]}
      onClick={() => onTransform({ [key]: !transform[key] })}
    >
      {label}
    </button>
  );

  const basic = (
    <>
      {onCommitRange ? (
        <InspectorGroup title={t("editor.range")}>
          <div className="editor-range editor-grid-2">
            <DraftField
              label={t("editor.rangeStart")}
              value={inS.toFixed(2)}
              min={0}
              step={0.01}
              onCommit={(seconds) => onCommitRange(seconds, outS)}
            />
            <DraftField
              label={t("editor.rangeEnd")}
              value={outS.toFixed(2)}
              min={0}
              step={0.01}
              onCommit={(seconds) => onCommitRange(inS, seconds)}
            />
          </div>
        </InspectorGroup>
      ) : null}

      <InspectorGroup title={t("editor.transform")}>
        <SegmentedToolbar
          ariaLabel={t("editor.rotate")}
          value={transform.rotate}
          onChange={(rotate) => onTransform({ rotate })}
          options={ROTATIONS.map((degrees) => ({ value: degrees, label: `${degrees}°` }))}
        />
        <div className="editor-grid-2">
          {flip("flipH", t("editor.flipH"))}
          {flip("flipV", t("editor.flipV"))}
        </div>
        <SegmentedToolbar
          ariaLabel={t("editor.fit")}
          value={transform.fit}
          onChange={(fit) => onTransform({ fit })}
          options={[
            { value: "fit", label: t("editor.fitContain") },
            { value: "fill", label: t("editor.fitCover") },
          ]}
        />
        <Slider
          label={t("editor.zoom")}
          display={`${transform.zoom.toFixed(2)}×`}
          value={transform.zoom}
          min={1}
          max={4}
          step={0.05}
          gesture={gesture}
          onChange={live("zoom")}
        />
        <Slider
          label={t("editor.offsetX")}
          display={transform.offsetX.toFixed(2)}
          value={transform.offsetX}
          min={-1}
          max={1}
          step={0.01}
          gesture={gesture}
          onChange={live("offsetX")}
        />
        <Slider
          label={t("editor.offsetY")}
          display={transform.offsetY.toFixed(2)}
          value={transform.offsetY}
          min={-1}
          max={1}
          step={0.01}
          gesture={gesture}
          onChange={live("offsetY")}
        />
      </InspectorGroup>

      <InspectorGroup title={t("editor.crop")}>
        <div className="editor-grid-4">
          {["x", "y", "w", "h"].map((key) => (
            <DraftField
              key={key}
              label={key.toUpperCase()}
              value={String(transform.crop[key])}
              min={0}
              max={1}
              step={0.01}
              onCommit={(value) => onTransform({ crop: { ...transform.crop, [key]: value } })}
            />
          ))}
        </div>
      </InspectorGroup>
    </>
  );

  const audio = (
    <InspectorGroup>
      <ToggleSwitch
        label={t("editor.mute")}
        checked={clip.muted === true}
        onChange={(muted) => onMute(muted)}
      />
    </InspectorGroup>
  );

  const speed = (
    <InspectorGroup>
      <Select
        size="sm"
        value={String(clip.speed)}
        onValueChange={(value) => onSpeed(Number(value))}
        aria-label={t("editor.speed")}
        options={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))}
      />
    </InspectorGroup>
  );

  return (
    <section className="editor-inspector" aria-label={t("editor.inspector.title")}>
      <header className="editor-side-head">
        <h2>{t("editor.inspector.title")}</h2>
        <span className="editor-muted" title={asset?.path}>
          {asset?.filename}
        </span>
      </header>
      <InspectorTabs
        label={t("editor.inspector.title")}
        tabs={[
          { id: "basic", label: t("editor.tab.basic"), content: basic },
          { id: "audio", label: t("editor.audio"), content: audio },
          { id: "speed", label: t("editor.speed"), content: speed },
        ]}
      />
    </section>
  );
}
