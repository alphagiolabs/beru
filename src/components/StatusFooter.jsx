import { useState, useEffect, useCallback } from "react";
import { shallow } from "zustand/shallow";
import { Command, Loader2, Zap, Terminal, CheckCircle2, LogOut } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { useT } from "../i18n/useT";
import { getBatchProgress } from "../utils/batch-progress";
import { APP_VERSION, formatFooterClock } from "../utils/appVersion";
import FooterChip from "./status-footer/FooterChip";
import SegmentedProgress from "./status-footer/SegmentedProgress";
import ExecutionHistoryPanel from "./status-footer/ExecutionHistoryPanel";
import UpToDateDialog from "./status-footer/UpToDateDialog";

/**
 * Ticks a counter every `intervalMs` while `active` is true, so time-based UI
 * (run/session clocks) re-renders at a fixed cadence instead of on every store
 * change. Returns nothing — callers read `Date.now()` during render.
 */
function useClock(active, intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setTick((n) => (n + 1) % 1e9), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}

export default function StatusFooter() {
  const t = useT();
  const get = useEditorStore.getState;
  const showToast = useEditorStore((s) => s.showToast);
  const signOut = useEditorStore((s) => s.signOut);
  const updateModalOpen = useEditorStore((s) => s.updateModalOpen);

  const [historyOpen, setHistoryOpen] = useState(false);

  const {
    isProcessing,
    progressDone,
    progressTotal,
    queueLength,
    jobProgress,
    batchSummary,
    update,
  } = useEditorStore(
    (s) => ({
      isProcessing: s.isProcessing,
      progressDone: s.progressDone,
      progressTotal: s.progressTotal,
      queueLength: s.queue.length,
      jobProgress: s.jobProgress,
      batchSummary: s.batchSummary,
      update: s.update,
    }),
    shallow,
  );

  // Only subscribe to the full history array while the panel is open. When
  // closed the selector returns null (stable) so log batches do not re-render
  // the footer (~20×/s during encode).
  const executionHistory = useEditorStore((s) => (historyOpen ? s.executionHistory : null));
  const [upToDateOpen, setUpToDateOpen] = useState(false);
  const closeUpToDate = useCallback(() => setUpToDateOpen(false), []);
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [sessionStartedAt] = useState(() => Date.now());

  const { completed, total, percent } = getBatchProgress({
    queue: get().queue,
    progressDone,
    progressTotal,
    jobProgress,
  });
  const showProgress = isProcessing || completed > 0 || percent > 0;

  const updateStatus = update?.status || "idle";
  const hasUpdateBadge =
    updateStatus === "available" || updateStatus === "downloading" || updateStatus === "ready";

  useEffect(() => {
    if (isProcessing) {
      setRunStartedAt((prev) => prev ?? Date.now());
      return;
    }
    setRunStartedAt(null);
  }, [isProcessing]);

  useClock(isProcessing || updateStatus === "downloading", 1000);

  useEffect(() => {
    if (updateStatus !== "idle" && updateStatus !== "disabled") {
      setUpToDateOpen(false);
    }
  }, [updateStatus]);

  const runClock = runStartedAt != null ? formatFooterClock(Date.now() - runStartedAt) : "00:00";
  const sessionClock = formatFooterClock(Date.now() - sessionStartedAt);

  const handleSignOut = async () => {
    const ok = await get().requestConfirm({ message: t("auth.signOutConfirm") });
    if (!ok) return;
    await signOut();
    showToast({ kind: "ok", text: t("auth.signedOut") });
  };

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

  const handleManualCheck = async () => {
    setUpToDateOpen(false);
    await get().checkForUpdates();
  };

  const versionLabel = `v${APP_VERSION}`;
  const updateVersionLabel = update?.version ? `v${update.version}` : null;

  return (
    <footer className="status-footer cap-no-drag" role="contentinfo">
      <div className="status-footer-left">
        {isSupabaseConfigured && (
          <button
            type="button"
            className="status-footer-icon-btn"
            onClick={handleSignOut}
            title={t("auth.signOut")}
            aria-label={t("auth.signOut")}
          >
            <LogOut size={13} strokeWidth={2.2} />
          </button>
        )}

        <button
          type="button"
          className={`status-footer-icon-btn${historyOpen ? " status-footer-icon-btn--active" : ""}`}
          onClick={() => {
            setHistoryOpen((v) => !v);
            get().setUpdateModalOpen(false);
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
            history={executionHistory || []}
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
              {batchSummary.cancelled > 0 && (
                <span className="status-footer-dim"> · {batchSummary.cancelled} cancel</span>
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
            className={`status-footer-version${hasUpdateBadge ? " status-footer-version--badge" : ""}${updateModalOpen || upToDateOpen ? " status-footer-version--open" : ""}`}
            onClick={() => {
              if (hasUpdateBadge || updateStatus === "checking") {
                const state = get();
                state.setUpdateModalOpen(!state.updateModalOpen);
                setUpToDateOpen(false);
              } else {
                setUpToDateOpen(true);
                get().setUpdateModalOpen(false);
              }
              setHistoryOpen(false);
            }}
            title={
              hasUpdateBadge
                ? t("footer.updateAvailable")
                : t("footer.version", { version: versionLabel })
            }
            aria-label={t("footer.version", { version: versionLabel })}
            aria-expanded={updateModalOpen || upToDateOpen}
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

      {upToDateOpen && (
        <UpToDateDialog onClose={closeUpToDate} onCheckForUpdates={handleManualCheck} t={t} />
      )}
    </footer>
  );
}
