import { useState, useRef, useEffect } from "react";
import { Save, Trash2 } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";

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

  return (
    <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
      <span className="cap-input-label">Presets</span>
      <div className="flex gap-1 mb-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre..."
          className="cap-input flex-1 text-[11px] !py-1"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          disabled={saving}
        />
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="cap-btn-secondary !px-2"
          title="Guardar preset"
        >
          <Save size={14} />
        </button>
      </div>
      {feedback && (
        <div
          className="text-[10px] mb-1"
          style={{ color: feedback.kind === "ok" ? "#22c55e" : "var(--rose)" }}
        >
          {feedback.text}
        </div>
      )}
      <div className="flex flex-wrap gap-1 max-h-[100px] overflow-y-auto">
        {presets.map((p) => (
          <div
            key={`${p.source}-${p.filename}`}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] cursor-pointer"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            onClick={() => getState().loadPreset(p)}
          >
            <span style={{ color: "var(--text-secondary)" }}>{p.name}</span>
            {p.source === "bundled" ? (
              <span
                style={{ color: "var(--text-dim)" }}
                className="opacity-60"
                title="Preset incluido (no se puede eliminar)"
              >
                <Trash2 size={10} />
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(p);
                }}
                disabled={deletingFilename === p.filename}
                style={{ color: "var(--text-dim)" }}
                className="hover:text-red-400 disabled:opacity-50"
                title="Eliminar preset"
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
