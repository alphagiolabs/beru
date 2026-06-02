import { useState } from "react";
import { Save, Trash2 } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";

export default function PresetManager() {
  const store = useEditorStore();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleSave = async () => {
    const cleanName = name.trim();
    if (!cleanName || saving) return;
    setSaving(true);
    setFeedback(null);
    const res = await store.savePreset(cleanName);
    setSaving(false);
    if (res?.ok) {
      setName("");
      setFeedback({ kind: "ok", text: `Guardado: ${res.fileName}` });
    } else {
      setFeedback({ kind: "err", text: res?.error || "No se pudo guardar el preset" });
    }
    setTimeout(() => setFeedback(null), 2500);
  };

  return (
    <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
      <span className="cap-input-label">Presets</span>
      <div className="flex gap-1 mb-2">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Nombre..." className="cap-input flex-1 text-[11px] !py-1"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          disabled={saving} />
        <button onClick={handleSave} disabled={!name.trim() || saving} className="cap-btn-secondary !px-2" title="Guardar preset">
          <Save size={14} />
        </button>
      </div>
      {feedback && (
        <div className="text-[10px] mb-1"
          style={{ color: feedback.kind === "ok" ? "#22c55e" : "var(--rose)" }}>
          {feedback.text}
        </div>
      )}
      <div className="flex flex-wrap gap-1 max-h-[100px] overflow-y-auto">
        {store.presets.map((p) => (
          <div key={p.id} className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] cursor-pointer"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            onClick={() => store.loadPreset(p)}>
            <span style={{ color: "var(--text-secondary)" }}>{p.name}</span>
            <button onClick={(e) => { e.stopPropagation(); store.deletePreset(p.id); }}
              style={{ color: "var(--text-dim)" }} className="hover:text-red-400">
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
