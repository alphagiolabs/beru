import { useState, useRef, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { InspectorGroup } from "./inspector";

export default function PresetManager() {
  const presets = useEditorStore((s) => s.presets);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingFilename, setDeletingFilename] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const getState = useEditorStore.getState;
  // Track pending feedback-clear timers so they are cancelled on unmount
  // (avoids setState-after-unmount / leaked timers if the component unmounts
  // within the 2.5s feedback window — e.g. when the active tool changes).
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
      setFeedback({ kind: "ok", text: `Guardado: ${res.fileName}` });
    } else {
      setFeedback({ kind: "err", text: res?.error || "No se pudo guardar el preset" });
    }
    scheduleFeedbackClear();
  };

  const handleDelete = async (preset) => {
    if (preset.source === "bundled") {
      setFeedback({ kind: "err", text: "Los presets incluidos no se pueden eliminar" });
      scheduleFeedbackClear();
      return;
    }
    if (deletingFilename) return;
    setDeletingFilename(preset.filename);
    setFeedback(null);
    const res = await getState().deletePreset(preset);
    setDeletingFilename(null);
    if (res?.ok) {
      setFeedback({ kind: "ok", text: `Eliminado: ${preset.name}` });
    } else {
      setFeedback({ kind: "err", text: res?.error || "No se pudo eliminar el preset" });
    }
    scheduleFeedbackClear();
  };

  const canSave = Boolean(name.trim()) && !saving;

  return (
    <InspectorGroup
      title="Presets"
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
              placeholder="Nombre…"
              className="inspector-user-presets-input"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              disabled={saving}
              aria-label="Nombre del preset"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={`inspector-user-presets-save-btn${canSave ? " is-ready" : ""}`}
              title="Guardar preset"
              aria-label="Guardar preset"
            >
              <Plus size={14} strokeWidth={2.25} />
            </button>
          </div>

          {presets.length > 0 ? (
            <ul className="inspector-user-presets-list" aria-label="Presets guardados">
              {presets.map((p) => {
                const isBundled = p.source === "bundled";
                const isDeleting = deletingFilename === p.filename;
                return (
                  <li
                    key={`${p.source}-${p.filename}`}
                    className={`inspector-user-presets-item${isBundled ? " is-bundled" : ""}`}
                  >
                    <button
                      type="button"
                      className="inspector-user-presets-load"
                      onClick={() => getState().loadPreset(p)}
                      title={isBundled ? `${p.name} (incluido)` : `Cargar: ${p.name}`}
                    >
                      <span className="inspector-user-presets-name">{p.name}</span>
                      {isBundled ? (
                        <span className="inspector-user-presets-tag">Incluido</span>
                      ) : null}
                    </button>
                    {!isBundled ? (
                      <button
                        type="button"
                        className="inspector-user-presets-delete"
                        onClick={() => handleDelete(p)}
                        disabled={isDeleting}
                        title="Eliminar preset"
                        aria-label={`Eliminar ${p.name}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    ) : null}
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
