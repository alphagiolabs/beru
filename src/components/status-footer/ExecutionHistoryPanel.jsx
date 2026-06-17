import { useRef, useCallback } from "react";
import { History, Download } from "lucide-react";
import useCloseOnOutsideClick from "../../hooks/useCloseOnOutsideClick";
import { formatRunTitle } from "./utils";

export default function ExecutionHistoryPanel({ history, onExport, onClear, onClose, t }) {
  const panelRef = useRef(null);
  const closeStable = useCallback(() => onClose(), [onClose]);
  useCloseOnOutsideClick(panelRef, true, closeStable);

  const hasRuns = history.length > 0;
  const hasLines = history.some((run) => run.lines.length > 0);

  return (
    <div ref={panelRef} className="status-footer-popover status-footer-popover--history">
      <div className="status-footer-popover-header">
        <History size={13} />
        <span>{t("footer.historyTitle")}</span>
      </div>
      <div className="status-footer-log-scroll">
        {!hasRuns ? (
          <p className="status-footer-log-empty">{t("footer.historyEmpty")}</p>
        ) : (
          history.map((run) => (
            <div key={run.id} className="status-footer-run-block">
              <div className="status-footer-run-header">{formatRunTitle(run, t)}</div>
              {run.lines.length === 0 ? (
                <p className="status-footer-log-empty">{t("footer.historyRunNoLogs")}</p>
              ) : (
                run.lines.map((line, i) => (
                  <div key={`${run.id}-${i}`} className="status-footer-log-line">
                    {line}
                  </div>
                ))
              )}
            </div>
          ))
        )}
      </div>
      {(hasLines || hasRuns) && (
        <div className="status-footer-popover-actions">
          {hasLines && (
            <button type="button" className="status-footer-link-btn" onClick={onExport}>
              <Download size={12} />
              {t("footer.exportLogs")}
            </button>
          )}
          {hasRuns && (
            <button type="button" className="status-footer-link-btn" onClick={onClear}>
              {t("footer.clearHistory")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
