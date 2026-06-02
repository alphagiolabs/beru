import { Droplet, Crop, Type, Eraser, Image } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

const tools = [
  { id: "blur", icon: Droplet, labelKey: "toolbar.blur" },
  { id: "crop", icon: Crop, labelKey: "toolbar.crop" },
  { id: "text", icon: Type, labelKey: "toolbar.text" },
  { id: "image", icon: Image, labelKey: "toolbar.image" },
  { id: "delogo", icon: Eraser, labelKey: "toolbar.delogo" },
];

export default function ToolBar() {
  const store = useEditorStore();
  const t = useT();
  const sel = store.selected();
  if (!sel || store.sidebarMode !== "logo") return null;

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-t flex-shrink-0" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
      {tools.map((tool) => {
        const active = store.activeTool === tool.id;
        const colors = {
          blur: "var(--accent)",
          crop: "var(--amber)",
          text: "var(--purple)",
          image: "#10b981",
          delogo: "var(--rose)",
        };
        const Icon = tool.icon;
        return (
          <button key={tool.id} onClick={() => store.setActiveTool(tool.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium transition-all"
            style={{
              background: active ? "var(--bg-elevated)" : "transparent",
              color: active ? colors[tool.id] : "var(--text-dim)",
              border: active ? `1px solid ${colors[tool.id]}33` : "1px solid transparent",
            }}>
            <Icon size={14} /> {t(tool.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
