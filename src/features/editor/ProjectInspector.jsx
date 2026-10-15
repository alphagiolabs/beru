import { useT } from "../../i18n/useT";
import { Select } from "../../components/ui/select";
import { InspectorGroup } from "../../components/inspector";
import CanvasFields from "./CanvasFields.jsx";
import DraftField from "./DraftField.jsx";

export default function ProjectInspector({
  canvas,
  onCanvasSize,
  onBackground,
  audio,
  onAudio,
  encodeProfile,
  onEncodeProfile,
}) {
  const t = useT();
  return (
    <section className="editor-inspector" aria-label={t("editor.project")}>
      <header className="editor-side-head">
        <h2>{t("editor.project")}</h2>
      </header>

      <InspectorGroup title={t("editor.canvas")}>
        <div className="editor-grid-2">
          <CanvasFields canvas={canvas} onSize={onCanvasSize} />
        </div>
        <DraftField
          label={t("editor.canvasBackground")}
          type="color"
          value={canvas.background}
          onCommit={onBackground}
        />
      </InspectorGroup>

      <InspectorGroup title={t("editor.exportSettings")}>
        <div className="editor-draft">
          <span className="editor-draft-label">{t("editor.audio")}</span>
          <Select
            size="sm"
            value={audio}
            onValueChange={onAudio}
            aria-label={t("editor.audio")}
            options={[
              { value: "original", label: t("editor.audioOriginal") },
              { value: "silence", label: t("editor.audioSilence") },
            ]}
          />
        </div>
        <div className="editor-draft">
          <span className="editor-draft-label">{t("header.encodeProfile")}</span>
          <Select
            size="sm"
            value={encodeProfile}
            onValueChange={onEncodeProfile}
            aria-label={t("header.encodeProfile")}
            options={[
              { value: "fast", label: t("header.encodeFast") },
              { value: "balanced", label: t("header.encodeBalanced") },
              { value: "quality", label: t("header.encodeQuality") },
              { value: "uquality", label: t("header.encodeUltraQuality") },
            ]}
          />
        </div>
      </InspectorGroup>
    </section>
  );
}
