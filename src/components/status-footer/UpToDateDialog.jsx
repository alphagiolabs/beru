import { useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "../ui/Button";
import { formatUpdateError } from "../../utils/updateErrors";

export default function UpToDateDialog({ update, onClose, onCheckForUpdates, t }) {
  const closeBtnRef = useRef(null);

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
    <div className="cap-modal-overlay status-footer-up-to-date-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="up-to-date-title"
        aria-describedby="up-to-date-description"
        className="status-footer-up-to-date-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <Button
          ref={closeBtnRef}
          type="button"
          className="status-footer-up-to-date-close"
          onClick={onClose}
          aria-label={t("common.close")}
          variant="tertiary"
          size="icon"
        >
          <X size={16} />
        </Button>
        {update?.verified && (
          <CheckCircle2 className="status-footer-up-to-date-icon" size={25} strokeWidth={2.25} />
        )}
        <h2 id="up-to-date-title" className="status-footer-up-to-date-title">
          {t(update?.verified ? "footer.upToDateTitle" : "footer.checkForUpdates")}
        </h2>
        <p id="up-to-date-description" className="status-footer-up-to-date-description">
          {t(update?.verified ? "footer.upToDateBody" : "footer.updateNotChecked")}
        </p>
        {update?.error && <p role="alert">{formatUpdateError(t, update.error)}</p>}
        {onCheckForUpdates && (
          <Button
            type="button"
            className="status-footer-up-to-date-check"
            onClick={onCheckForUpdates}
            variant="tertiary"
            size="sm"
          >
            {t("footer.checkForUpdates")}
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}
