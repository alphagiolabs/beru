import useEditorStore from "../stores/useEditorStore";

const TOAST_COLORS = {
  ok: "#22c55e",
  warn: "#fbbf24",
  err: "#ef4444",
};

export default function AppToast() {
  const toast = useEditorStore((s) => s.appToast);
  if (!toast) return null;

  const border = TOAST_COLORS[toast.kind] || TOAST_COLORS.warn;

  return (
    <div
      className="app-toast-layer fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md px-3 py-2 text-[11px] shadow-lg max-w-[min(90vw,480px)]"
      role={toast.kind === "err" ? "alert" : "status"}
      aria-live={toast.kind === "err" ? "assertive" : "polite"}
      style={{
        background: "var(--bg-elevated)",
        border: `1px solid ${border}`,
        color: "var(--text-primary)",
      }}
    >
      {toast.text}
    </div>
  );
}
