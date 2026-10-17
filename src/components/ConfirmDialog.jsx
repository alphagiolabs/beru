import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";

export default function ConfirmDialog() {
  const t = useT();
  const dialog = useEditorStore((s) => s.confirmDialog);
  const resolveConfirm = useEditorStore((s) => s.resolveConfirm);
  const confirmBtnRef = useRef(null);
  const cancelBtnRef = useRef(null);
  const isDanger = dialog?.variant === "danger";

  useEffect(() => {
    if (!dialog) return undefined;
    // Destructive dialogs start on the safe choice so Enter never discards work.
    (isDanger ? cancelBtnRef : confirmBtnRef).current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolveConfirm(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, isDanger, resolveConfirm]);

  if (!dialog) return null;

  const { title, message, confirmLabel, cancelLabel } = dialog;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      className="cap-modal-overlay cap-modal-overlay--stack"
      onClick={() => resolveConfirm(false)}
    >
      <div
        className={`cap-modal-panel cap-dialog${isDanger ? " cap-dialog--danger" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cap-dialog-content">
          <div className="cap-dialog-icon" aria-hidden="true">
            <AlertTriangle size={16} strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <h2 id="confirm-dialog-title" className="cap-dialog-title">
              {title || t("dialog.confirmTitle")}
            </h2>
            <p id="confirm-dialog-message" className="cap-dialog-message">
              {message}
            </p>
          </div>
        </div>

        <div className="cap-dialog-actions">
          <Button
            ref={cancelBtnRef}
            type="button"
            onClick={() => resolveConfirm(false)}
            variant="secondary"
            size="md"
          >
            {cancelLabel || t("common.cancel")}
          </Button>
          <Button
            ref={confirmBtnRef}
            type="button"
            onClick={() => resolveConfirm(true)}
            variant={isDanger ? "danger" : "primary"}
            size="md"
          >
            {confirmLabel || t("common.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
