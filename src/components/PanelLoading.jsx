import { Loader2, X } from "lucide-react";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";

export default function PanelLoading({ label, onClose }) {
  const t = useT();
  const status = (
    <div className="panel-loading" role="status" aria-live="polite" aria-busy="true">
      <Loader2 size={18} className="panel-loading-spinner" aria-hidden="true" />
      <span>{t("common.loadingPanel", { panel: label })}</span>
    </div>
  );

  if (!onClose) return status;

  return (
    <div className="cap-modal-overlay" onClick={onClose}>
      <div
        className="cap-modal-panel panel-loading-modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {status}
        <Button
          type="button"
          variant="tertiary"
          size="icon"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
