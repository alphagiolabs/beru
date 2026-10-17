import { useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info } from "lucide-react";
import { Button } from "../ui/Button";
import { formatUpdateError } from "../../utils/updateErrors";

export default function UpToDateDialog({ update, onClose, onCheckForUpdates, t }) {
  const closeBtnRef = useRef(null);
  const verified = Boolean(update?.verified);

  useEffect(() => {
    closeBtnRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="cap-modal-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="up-to-date-title"
        aria-describedby="up-to-date-description"
        className={`cap-modal-panel cap-dialog cap-dialog--${verified ? "success" : "neutral"} status-footer-up-to-date-panel`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cap-dialog-content">
          <div className="cap-dialog-icon" aria-hidden="true">
            {verified ? <CheckCircle2 size={16} strokeWidth={2.25} /> : <Info size={16} />}
          </div>
          <div className="min-w-0">
            <h2 id="up-to-date-title" className="cap-dialog-title">
              {t(verified ? "footer.upToDateTitle" : "footer.checkForUpdates")}
            </h2>
            <p id="up-to-date-description" className="cap-dialog-message">
              {t(verified ? "footer.upToDateBody" : "footer.updateNotChecked")}
            </p>
            {update?.error && (
              <p className="cap-dialog-message cap-dialog-message--error" role="alert">
                {formatUpdateError(t, update.error)}
              </p>
            )}
          </div>
        </div>

        <div className="cap-dialog-actions">
          {onCheckForUpdates && (
            <Button
              type="button"
              className="status-footer-up-to-date-check"
              onClick={onCheckForUpdates}
              variant="secondary"
              size="md"
            >
              {t("footer.checkForUpdates")}
            </Button>
          )}
          <Button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            variant="primary"
            size="md"
          >
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
