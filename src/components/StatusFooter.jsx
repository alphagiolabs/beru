import { useState, useEffect, useRef, useCallback } from "react";
import { shallow } from "zustand/shallow";
import { Command, Loader2, Zap, Terminal, Download, History, CheckCircle2 } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import useCloseOnOutsideClick from "../hooks/useCloseOnOutsideClick";
import { useT } from "../i18n/useT";
import { getBatchProgress } from "../utils/batch-progress";
import { APP_VERSION, formatFooterClock, parseReleaseNotes } from "../utils/appVersion";
import { formatHistoryTimestamp } from "../utils/execution-history";

const DISMISS_KEY = "beru.updateReady.dismissedVersion";

const safeStorage = {
  get(k) {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(k) : null;
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(k, v);
    } catch {}
  },
};

function FooterChip({ children, className = "", title, onClick, active }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={`status-footer-chip ${active ? "status-footer-chip--active" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}

function SegmentedProgress({ percent }) {
  const segments = 20;
  const filled = Math.round((percent / 100) * segments);
  return (
    <div className="status-footer-progress" aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={`status-footer-progress-seg${i < filled ? " status-footer-progress-seg--on" : ""}`}
        />
      ))}
    </div>
  );
}

function formatRunTitle(run, t) {
  const started = formatHistoryTimestamp(run.startedAt);
  const kind =
    run.kind === "single"
      ? t("footer.historySingle")
      : t("footer.historyBatch", { count: run.jobCount || 0 });
  if (run.summary) {
    const failed =
      run.summary.failed > 0 ? t("footer.historyFailed", { count: run.summary.failed }) : "";
    return t("footer.historyRunDone", {
      started,
      kind,
      ok: run.summary.succeeded,
      total: run.summary.total,
      failed,
    });
  }
  if (run.finishedAt) {
    return t("footer.historyRunFinished", { started, kind });
  }
  return t("footer.historyRunActive", { started, kind });
}

function ExecutionHistoryPanel({ history, onExport, onClear, onClose, t }) {
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

function UpdatePopover({ update, onUpdateNow, onLater, onInstall, onReleaseNotes, onClose, t }) {
  const panelRef = useRef(null);
  const closeStable = useCallback(() => onClose(), [onClose]);
  useCloseOnOutsideClick(panelRef, true, closeStable);

  const status = update?.status || "idle";
  const notes = parseReleaseNotes(update?.releaseNotes);
  const hiddenCount = Math.max(
    0,
    parseReleaseNotes(update?.releaseNotes, 999).length - notes.length,
  );
  const percent = Math.max(0, Math.min(100, Math.round(update?.percent || 0)));

  return (
    <div ref={panelRef} className="status-footer-popover status-footer-popover--update">
      <div className="status-footer-popover-header">
        <Terminal size={13} />
        <span>
          {status === "ready"
            ? t("updater.modal.title")
            : status === "downloading"
              ? t("footer.updateDownloading", { percent, version: update?.version || "?" })
              : t("footer.updateAvailable")}
        </span>
      </div>

      {status === "ready" ? (
        <>
          <p className="status-footer-update-body">
            {t("updater.modal.body", { version: update?.version || "?" })}
          </p>
          <p className="status-footer-update-note">{t("updater.modal.note")}</p>
          <button type="button" className="status-footer-primary-btn" onClick={onInstall}>
            {t("updater.modal.install")}
          </button>
          <button type="button" className="status-footer-secondary-btn" onClick={onLater}>
            {t("updater.modal.later")}
          </button>
        </>
      ) : status === "downloading" ? (
        <>
          <div className="status-footer-download-bar">
            <div className="status-footer-download-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="status-footer-update-meta">{t("footer.updateWait")}</p>
        </>
      ) : (
        <>
          {notes.length > 0 && (
            <ul className="status-footer-notes">
              {notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {hiddenCount > 0 && (
            <p className="status-footer-update-meta">
              {t("footer.moreChanges", { count: hiddenCount })}
            </p>
          )}
          <button type="button" className="status-footer-primary-btn" onClick={onUpdateNow}>
            {t("footer.updateNow")}
          </button>
          <button type="button" className="status-footer-secondary-btn" onClick={onLater}>
            {t("footer.maybeLater")}
          </button>
          {update?.releaseUrl && (
            <button type="button" className="status-footer-link-btn" onClick={onReleaseNotes}>
              {t("footer.checkReleaseNotes")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function StatusFooter() {
  const t = useT();
  const get = useEditorStore.getState;
  const showToast = useEditorStore((s) => s.showToast);

  const {
    isProcessing,
    progressDone,
    progressTotal,
    queue,
    executionHistory,
    batchSummary,
    update,
  } = useEditorStore(
    (s) => ({
      isProcessing: s.isProcessing,
      progressDone: s.progressDone,
      progressTotal: s.progressTotal,
      queue: s.queue,
      executionHistory: s.executionHistory,
      batchSummary: s.batchSummary,
      update: s.update,
    }),
    shallow,
  );

  const [historyOpen, setHistoryOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [sessionStartedAt] = useState(() => Date.now());
  const [clockTick, setClockTick] = useState(0);

  const { completed, total, percent } = getBatchProgress({
    queue,
    progressDone,
    progressTotal,
  });
  const showProgress = isProcessing || completed > 0 || percent > 0;

  const updateStatus = update?.status || "idle";
  const hasUpdateBadge =
    updateStatus === "available" ||
    updateStatus === "downloading" ||
    (updateStatus === "ready" &&
      update?.version &&
      safeStorage.get(DISMISS_KEY) !== update.version);

  useEffect(() => {
    if (isProcessing) {
      setRunStartedAt((prev) => prev ?? Date.now());
      return;
    }
    setRunStartedAt(null);
  }, [isProcessing]);

  useEffect(() => {
    if (!isProcessing && updateStatus !== "downloading") return undefined;
    const id = setInterval(() => setClockTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isProcessing, updateStatus]);

  useEffect(() => {
    if (
      updateStatus === "ready" &&
      update?.version &&
      safeStorage.get(DISMISS_KEY) !== update.version
    ) {
      setUpdateOpen(true);
    }
  }, [updateStatus, update?.version]);

  const runClock = runStartedAt != null ? formatFooterClock(Date.now() - runStartedAt) : "00:00";
  const sessionClock = formatFooterClock(Date.now() - sessionStartedAt);
  void clockTick;

  const handleClearHistory = async () => {
    const ok = await get().requestConfirm({ message: t("footer.clearHistoryConfirm") });
    if (!ok) return;
    await get().clearExecutionHistory();
    showToast({ kind: "ok", text: t("footer.historyCleared") });
  };

  const handleExportLogs = async () => {
    const state = get();
    const res = await window.api?.exportProcessingLogs?.(state.exportProcessingLogsText());
    if (res?.success) {
      showToast({ kind: "ok", text: t("footer.logsExported") });
    } else if (!res?.canceled) {
      showToast({ kind: "err", text: t("footer.logsExportFailed") });
    }
  };

  const handleUpdateNow = async () => {
    const res = await get().downloadUpdate();
    if (res?.ok === false) {
      showToast({ kind: "err", text: t("header.updateDownloadFailed") });
    }
  };

  const handleUpdateLater = () => {
    if (updateStatus === "ready" && update?.version) {
      safeStorage.set(DISMISS_KEY, update.version);
      useEditorStore.setState((s) => ({
        update: { ...s.update, status: "idle" },
      }));
    }
    setUpdateOpen(false);
  };

  const handleInstall = () => {
    get().installUpdate();
  };

  const handleReleaseNotes = () => {
    if (update?.releaseUrl) {
      window.api?.openExternal?.(update.releaseUrl);
    }
    setUpdateOpen(false);
  };

  const versionLabel = `v${APP_VERSION}`;
  const updateVersionLabel = update?.version ? `v${update.version}` : null;

  return (
    <footer className="status-footer cap-no-drag" role="contentinfo">
      <div className="status-footer-left">
        <button
          type="button"
          className={`status-footer-icon-btn${historyOpen ? " status-footer-icon-btn--active" : ""}`}
          onClick={() => {
            setHistoryOpen((v) => !v);
            setUpdateOpen(false);
          }}
          title={t("footer.historyTitle")}
          aria-label={t("footer.historyTitle")}
          aria-expanded={historyOpen}
        >
          <Command size={13} strokeWidth={2.2} />
        </button>

        {historyOpen && (
          <ExecutionHistoryPanel
            history={executionHistory}
            onExport={handleExportLogs}
            onClear={handleClearHistory}
            onClose={() => setHistoryOpen(false)}
            t={t}
          />
        )}

        {!isProcessing && batchSummary && (
          <FooterChip title={t("footer.lastBatch")}>
            <CheckCircle2 size={11} />
            <span>
              {batchSummary.succeeded}/{batchSummary.total}
              {batchSummary.failed > 0 && (
                <span className="status-footer-err"> · {batchSummary.failed} err</span>
              )}
            </span>
          </FooterChip>
        )}

        {!isProcessing && !batchSummary && (
          <FooterChip>
            <span className="status-footer-dim">{t("footer.ready")}</span>
          </FooterChip>
        )}
      </div>

      <div className="status-footer-center">
        {isProcessing && (
          <FooterChip className="status-footer-running">
            <Loader2 size={11} className="status-footer-spin" />
            <span>
              {t("footer.running")} {runClock}
            </span>
          </FooterChip>
        )}

        {showProgress && (
          <>
            <FooterChip className="status-footer-progress-label">
              {isProcessing ? t("batchProgress.processing") : t("batchProgress.done")} {completed}/
              {total}
            </FooterChip>
            <SegmentedProgress percent={percent} />
            <span className="status-footer-percent">{Math.round(percent)}%</span>
          </>
        )}

        {(isProcessing || showProgress) && (
          <FooterChip title={t("footer.session")}>
            <Zap size={11} />
            <span>
              {t("footer.session")} {sessionClock}
            </span>
          </FooterChip>
        )}
      </div>

      <div className="status-footer-right">
        <div className="status-footer-version-wrap">
          <button
            type="button"
            className={`status-footer-version${hasUpdateBadge ? " status-footer-version--badge" : ""}${updateOpen ? " status-footer-version--open" : ""}`}
            onClick={() => {
              if (!hasUpdateBadge && updateStatus !== "checking") return;
              setUpdateOpen((v) => !v);
              setHistoryOpen(false);
            }}
            title={
              hasUpdateBadge
                ? t("footer.updateAvailable")
                : t("footer.version", { version: versionLabel })
            }
            aria-label={t("footer.version", { version: versionLabel })}
            aria-expanded={updateOpen}
          >
            <Terminal size={11} />
            <span>
              # {versionLabel}
              {updateVersionLabel && hasUpdateBadge && updateVersionLabel !== versionLabel && (
                <span className="status-footer-version-new"> → {updateVersionLabel}</span>
              )}
            </span>
            {updateStatus === "downloading" && (
              <span className="status-footer-version-dl">{Math.round(update?.percent || 0)}%</span>
            )}
          </button>

          {updateOpen && hasUpdateBadge && (
            <UpdatePopover
              update={update}
              onUpdateNow={handleUpdateNow}
              onLater={handleUpdateLater}
              onInstall={handleInstall}
              onReleaseNotes={handleReleaseNotes}
              onClose={() => setUpdateOpen(false)}
              t={t}
            />
          )}
        </div>
      </div>
    </footer>
  );
}
