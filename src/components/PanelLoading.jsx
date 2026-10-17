import { Loader2 } from "lucide-react";
import { useT } from "../i18n/useT";
import { ModalCloseButton } from "./ui/ModalCloseButton";

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
        <ModalCloseButton onClick={onClose} label={t("common.close")} />
      </div>
    </div>
  );
}
