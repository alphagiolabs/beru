import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

export default function ConfirmDialog() {
  const t = useT();
  const dialog = useEditorStore((s) => s.confirmDialog);
  const resolveConfirm = useEditorStore((s) => s.resolveConfirm);
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    if (!dialog) return undefined;
    confirmBtnRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolveConfirm(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, resolveConfirm]);

  if (!dialog) return null;

  const {
    title,
    message,
    confirmLabel,
    cancelLabel,
    variant = "default",
  } = dialog;

  const isDanger = variant === "danger";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      className="cap-modal-overlay"
      onClick={() => resolveConfirm(false)}
    >
      <div
        className="cap-modal-panel max-w-[420px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cap-modal-header">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: isDanger ? "rgba(244,63,94,0.12)" : "rgba(251,191,36,0.12)",
              color: isDanger ? "var(--rose)" : "var(--amber)",
            }}
          >
            <AlertTriangle size={20} strokeWidth={2.25} />
          </div>
          <h2
            id="confirm-dialog-title"
            className="text-sm font-semibold leading-snug"
            style={{ color: "var(--text-primary)" }}
          >
            {title || t("dialog.confirmTitle")}
          </h2>
        </div>

        <p id="confirm-dialog-message" className="cap-modal-body">
          {message}
        </p>

        <div className="cap-modal-footer">
          <button
            type="button"
            onClick={() => resolveConfirm(false)}
            className="cap-btn-secondary !text-[12px] !px-4 !py-2"
          >
            {cancelLabel || t("common.cancel")}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => resolveConfirm(true)}
            className={`!text-[12px] !px-4 !py-2 ${isDanger ? "cap-btn-danger" : "cap-btn-primary"}`}
          >
            {confirmLabel || t("common.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
