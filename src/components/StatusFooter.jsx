import { useState, useEffect, useCallback } from "react";
import { shallow } from "zustand/shallow";
import { Command, Loader2, Zap, Terminal, CheckCircle2 } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { getBatchProgress } from "../utils/batch-progress";
import { APP_VERSION, formatFooterClock } from "../utils/appVersion";
import FooterChip from "./status-footer/FooterChip";
import SegmentedProgress from "./status-footer/SegmentedProgress";
import ExecutionHistoryPanel from "./status-footer/ExecutionHistoryPanel";
import UpdateModal from "./status-footer/UpdateModal";
import UpToDateDialog from "./status-footer/UpToDateDialog";

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
  const [upToDateOpen, setUpToDateOpen] = useState(false);
  const closeUpToDate = useCallback(() => setUpToDateOpen(false), []);
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
  // The update badge stays visible for every active state. There is no
  // permanent dismiss — the notification must persist until the app is fully
  // up to date, so the user is always reminded that an update is waiting.
  const hasUpdateBadge =
    updateStatus === "available" || updateStatus === "downloading" || updateStatus === "ready";

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
    // Auto-open the install modal whenever an update is ready to install, on
    // every launch, so the prompt is persistent until the update is applied.
    if (updateStatus === "ready" && update?.version) {
      setUpdateOpen(true);
    }
  }, [updateStatus, update?.version]);

  useEffect(() => {
    if (updateStatus !== "idle" && updateStatus !== "disabled") {
      setUpToDateOpen(false);
    }
  }, [updateStatus]);

  useEffect(() => {
    if (updateStatus !== "available" || !update?.error) return;
    showToast({ kind: "err", text: t("header.updateDownloadFailed") });
    useEditorStore.setState((s) => ({
      update: { ...s.update, error: null },
    }));
  }, [updateStatus, update?.error, showToast, t]);

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
    // Session-only deferral: just close the modal. The badge stays visible and
    // the modal re-opens on the next launch, so the update remains persistent
    // until it is actually installed (no permanent dismiss).
    setUpdateOpen(false);
  };

  const handleInstall = async () => {
    const res = await get().installUpdate();
    if (res?.ok === false) {
      showToast({ kind: "err", text: t("header.updateDownloadFailed") });
    }
  };

  const handleOpenReleaseNotes = (url) => {
    window.api?.openExternal?.(url);
  };

  const handleManualCheck = async () => {
    setUpToDateOpen(false);
    await get().checkForUpdates();
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
            setUpToDateOpen(false);
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
            className={`status-footer-version${hasUpdateBadge ? " status-footer-version--badge" : ""}${updateOpen || upToDateOpen ? " status-footer-version--open" : ""}`}
            onClick={() => {
              if (hasUpdateBadge || updateStatus === "checking") {
                setUpdateOpen((v) => !v);
                setUpToDateOpen(false);
              } else {
                setUpToDateOpen(true);
                setUpdateOpen(false);
              }
              setHistoryOpen(false);
            }}
            title={
              hasUpdateBadge
                ? t("footer.updateAvailable")
                : t("footer.version", { version: versionLabel })
            }
            aria-label={t("footer.version", { version: versionLabel })}
            aria-expanded={updateOpen || upToDateOpen}
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
        </div>
      </div>

      {updateOpen && hasUpdateBadge && (
        <UpdateModal
          update={update}
          onUpdateNow={handleUpdateNow}
          onLater={handleUpdateLater}
          onInstall={handleInstall}
          onClose={() => setUpdateOpen(false)}
          onOpenReleaseNotes={handleOpenReleaseNotes}
          t={t}
        />
      )}

      {upToDateOpen && (
        <UpToDateDialog onClose={closeUpToDate} onCheckForUpdates={handleManualCheck} t={t} />
      )}
    </footer>
  );
}
