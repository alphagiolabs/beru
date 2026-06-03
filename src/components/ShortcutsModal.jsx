import { X } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

export default function ShortcutsModal() {
  const store = useEditorStore();
  const t = useT();
  if (!store.showShortcuts) return null;

  const groups = [
    {
      titleKey: "modal.shortcuts.playback",
      items: [
        ["Espacio", t("modal.shortcuts.playPause")],
        ["←  →", t("modal.shortcuts.seek5")],
        ["Shift + ←  →", t("modal.shortcuts.seek1")],
        [
          "Inicio / Fin",
          `${t("modal.shortcuts.jumpStart")} / ${t("modal.shortcuts.jumpEnd").toLowerCase()}`,
        ],
      ],
    },
    {
      titleKey: "modal.shortcuts.queue",
      items: [
        [
          "[  ]",
          `${t("modal.shortcuts.prevVideo")} / ${t("modal.shortcuts.nextVideo").toLowerCase()}`,
        ],
        [
          "↑  ↓",
          `${t("modal.shortcuts.prevVideo")} / ${t("modal.shortcuts.nextVideo").toLowerCase()}`,
        ],
      ],
    },
    {
      titleKey: "modal.shortcuts.tools",
      items: [
        ["1", t("modal.shortcuts.toolBlur")],
        ["2", t("modal.shortcuts.toolCrop")],
        ["3", t("modal.shortcuts.toolText")],
        ["4", t("modal.shortcuts.toolImage")],
        ["5", t("modal.shortcuts.toolDelogo")],
      ],
    },
    {
      titleKey: "modal.shortcuts.region",
      items: [
        ["N", t("modal.shortcuts.newRegion")],
        ["Supr / Backspace", t("modal.shortcuts.cancelRegion")],
        ["Esc", t("modal.shortcuts.cancelRegion")],
      ],
    },
    {
      titleKey: "modal.shortcuts.project",
      items: [
        ["Ctrl + S", t("modal.shortcuts.saveProject")],
        ["Ctrl + O", t("modal.shortcuts.loadProject")],
        ["Ctrl + Z", t("modal.shortcuts.undo")],
        ["Ctrl + Y / Ctrl + Shift + Z", t("modal.shortcuts.redo")],
        ["?", t("modal.shortcuts.shortcutsList")],
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={() => store.setShowShortcuts(false)}
    >
      <div
        className="w-[400px] rounded-lg shadow-2xl"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-sm font-semibold">{t("modal.shortcuts.title")}</span>
          <button
            onClick={() => store.setShowShortcuts(false)}
            className="p-1 rounded hover:bg-white/10"
            style={{ color: "var(--text-dim)" }}
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {groups.map((g) => (
            <div key={g.titleKey}>
              <div
                className="text-[9px] font-semibold tracking-wider uppercase mb-1.5"
                style={{ color: "var(--text-dim)" }}
              >
                {t(g.titleKey)}
              </div>
              <div className="space-y-1.5">
                {g.items.map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-3">
                    <kbd
                      className="min-w-[140px] px-2 py-0.5 rounded font-mono text-[10px] text-center whitespace-nowrap"
                      style={{
                        background: "var(--bg-app)",
                        border: "1px solid var(--border)",
                        color: "var(--accent)",
                      }}
                    >
                      {key}
                    </kbd>
                    <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {desc}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
