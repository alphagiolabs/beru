import useEditorStore from "../stores/useEditorStore";

const TOAST_COLORS = {
  ok: { border: "#22c55e", fg: "#22c55e" },
  warn: { border: "#fbbf24", fg: "#fbbf24" },
  err: { border: "#ef4444", fg: "#ef4444" },
};

export default function AppToast() {
  const toast = useEditorStore((s) => s.appToast);
  if (!toast) return null;

  const colors = TOAST_COLORS[toast.kind] || TOAST_COLORS.warn;

  return (
    <div
      className="app-toast-layer fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md px-3 py-2 text-[11px] shadow-lg max-w-[min(90vw,480px)]"
      style={{
        background: "var(--bg-elevated)",
        border: `1px solid ${colors.border}`,
        color: colors.fg,
      }}
    >
      {toast.text}
    </div>
  );
}
