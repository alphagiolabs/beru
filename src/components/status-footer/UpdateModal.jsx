import { useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { parseReleaseNotesSections } from "../../utils/appVersion";
import { formatUpdateError } from "../../utils/updateErrors";
import BeruMark from "./BeruMark";
import UpdateChangelog from "./UpdateChangelog";

export default function UpdateModal({
  update,
  isStartingDownload = false,
  onUpdateNow,
  onLater,
  onInstall,
  onClose,
  t,
}) {
  const closeBtnRef = useRef(null);
  const status = update?.status || "idle";
  const sections = parseReleaseNotesSections(update?.releaseNotes);
  const percent = Math.max(0, Math.min(100, Math.round(update?.percent || 0)));
  const version = update?.version || "?";
  const inlineError =
    status === "available" && update?.error ? formatUpdateError(t, update.error) : null;
  const isBusy = isStartingDownload || status === "downloading";

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

  const title =
    status === "ready"
      ? t("updater.modal.title")
      : status === "downloading"
        ? t("footer.updateDownloading", { percent, version })
        : t("updater.modal.title");

  return createPortal(
    <div className="cap-modal-overlay status-footer-update-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        className="status-footer-update-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeBtnRef}
          type="button"
          className="status-footer-update-close"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X size={16} />
        </button>

        <div className="status-footer-update-brand">
          <BeruMark />
        </div>

        <h2 id="update-modal-title" className="status-footer-update-title">
          {title}
        </h2>

        {status === "ready" ? (
          <>
            <p className="status-footer-update-subtitle">{t("updater.modal.body", { version })}</p>
            <p className="status-footer-update-warning">{t("updater.modal.note")}</p>
            <button type="button" className="status-footer-update-primary" onClick={onInstall}>
              {t("updater.modal.install")}
            </button>
            <button type="button" className="status-footer-update-secondary" onClick={onLater}>
              {t("updater.modal.later")}
            </button>
          </>
        ) : status === "downloading" ? (
          <>
            <div className="status-footer-update-progress">
              <div
                className="status-footer-update-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="status-footer-update-progress-label">{percent}%</p>
          </>
        ) : (
          <>
            <p className="status-footer-update-subtitle">{t("updater.modal.subtitle")}</p>
            <UpdateChangelog sections={sections} t={t} />
            {inlineError && (
              <p className="status-footer-update-error" role="alert">
                {inlineError}
              </p>
            )}
            <button
              type="button"
              className="status-footer-update-primary"
              onClick={onUpdateNow}
              disabled={isBusy}
            >
              {isStartingDownload ? (
                <>
                  <Loader2 size={14} className="status-footer-spin inline mr-1.5" />
                  {t("footer.updateStarting")}
                </>
              ) : (
                t("footer.updateNow")
              )}
            </button>
            <button
              type="button"
              className="status-footer-update-secondary"
              onClick={onLater}
              disabled={isStartingDownload}
            >
              {t("footer.maybeLater")}
            </button>
            {sections.hiddenCount > 0 && (
              <p className="status-footer-update-more">
                {t("footer.moreChanges", { count: sections.hiddenCount })}
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
