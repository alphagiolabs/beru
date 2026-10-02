import { useState, useRef, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { InspectorGroup } from "./inspector";

export default function PresetManager() {
  const presets = useEditorStore((s) => s.presets);
  const t = useT();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingFilename, setDeletingFilename] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const getState = useEditorStore.getState;
  const feedbackTimerRef = useRef(null);
  const scheduleFeedbackClear = () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
      setFeedback(null);
    }, 2500);
  };
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const handleSave = async () => {
    const cleanName = name.trim();
    if (!cleanName || saving) return;
    setSaving(true);
    setFeedback(null);
    const res = await getState().savePreset(cleanName);
    setSaving(false);
    if (res?.ok) {
      setName("");
      setFeedback({ kind: "ok", text: t("modal.preset.savedFeedback", { name: res.fileName }) });
    } else {
      setFeedback({ kind: "err", text: res?.error || t("header.couldNotSavePreset") });
    }
    scheduleFeedbackClear();
  };

  const handleDelete = async (preset) => {
    if (deletingFilename) return;
    setDeletingFilename(preset.filename);
    setFeedback(null);
    const res = await getState().deletePreset(preset);
    setDeletingFilename(null);
    if (res?.ok) {
      setFeedback({ kind: "ok", text: t("modal.preset.deletedFeedback", { name: preset.name }) });
    } else {
      setFeedback({ kind: "err", text: res?.error || t("header.couldNotSavePreset") });
    }
    scheduleFeedbackClear();
  };

  const canSave = Boolean(name.trim()) && !saving;

  return (
    <InspectorGroup
      title={t("header.presets")}
      className="inspector-group--user-presets"
      collapsible
      defaultOpen
    >
      <div className="inspector-user-presets">
        <div className="inspector-user-presets-shell">
          <div className="inspector-user-presets-save">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("modal.preset.namePlaceholder")}
              className="inspector-user-presets-input"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              disabled={saving}
              aria-label={t("modal.preset.nameAria")}
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={`inspector-user-presets-save-btn${canSave ? " is-ready" : ""}`}
              title={t("modal.preset.save")}
              aria-label={t("modal.preset.save")}
            >
              <Plus size={14} strokeWidth={2.25} />
            </button>
          </div>

          {presets.length > 0 ? (
            <ul className="inspector-user-presets-list" aria-label={t("modal.preset.listAria")}>
              {presets.map((p) => {
                const isDeleting = deletingFilename === p.filename;
                return (
                  <li key={p.filename} className="inspector-user-presets-item">
                    <button
                      type="button"
                      className="inspector-user-presets-load"
                      onClick={() => getState().applyPreset(p.data)}
                      title={t("modal.preset.load", { name: p.name })}
                    >
                      <span className="inspector-user-presets-name">{p.name}</span>
                    </button>
                    <button
                      type="button"
                      className="inspector-user-presets-delete"
                      onClick={() => handleDelete(p)}
                      disabled={isDeleting}
                      title={t("modal.preset.delete")}
                      aria-label={t("modal.preset.deleteAria", { name: p.name })}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        {feedback ? (
          <p
            className={`inspector-user-presets-feedback is-${feedback.kind}`}
            role="status"
            aria-live="polite"
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
    </InspectorGroup>
  );
}
