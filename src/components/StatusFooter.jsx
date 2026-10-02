import { useState, useEffect, useCallback } from "react";
import { shallow } from "zustand/shallow";
import { Loader2, Zap, Terminal, CheckCircle2 } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { getBatchProgress } from "../utils/batch-progress";
import { APP_VERSION, formatFooterClock } from "../utils/appVersion";
import { Button } from "./ui/Button";
import FooterChip from "./status-footer/FooterChip";
import SegmentedProgress from "./status-footer/SegmentedProgress";
import UpToDateDialog from "./status-footer/UpToDateDialog";

function jobProgressEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (
      !Object.prototype.hasOwnProperty.call(b, k) ||
      Math.round(Number(a[k])) !== Math.round(Number(b[k]))
    ) {
      return false;
    }
  }
  return true;
}

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
  const updateModalOpen = useEditorStore((s) => s.updateModalOpen);

  const { isProcessing, progressDone, progressTotal, batchSummary, update } = useEditorStore(
    (s) => ({
      isProcessing: s.isProcessing,
      progressDone: s.progressDone,
      progressTotal: s.progressTotal,
      queueLength: s.queue.length,
      batchSummary: s.batchSummary,
      update: s.update,
    }),
    shallow,
  );

  const jobProgress = useEditorStore((s) => s.jobProgress, jobProgressEqual);

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

  const handleManualCheck = async () => {
    setUpToDateOpen(false);
    await get().checkForUpdates();
  };

  const versionLabel = `v${APP_VERSION}`;
  const updateVersionLabel = update?.version ? `v${update.version}` : null;

  return (
    <footer className="status-footer" role="contentinfo">
      <div className="status-footer-left">
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
            <FooterChip>
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
          <Button
            type="button"
            className={`status-footer-version${hasUpdateBadge ? " status-footer-version--badge" : ""}${updateModalOpen || upToDateOpen ? " status-footer-version--open" : ""}`}
            variant="tertiary"
            size="sm"
            onClick={() => {
              if (hasUpdateBadge || updateStatus === "checking") {
                const state = get();
                state.setUpdateModalOpen(!state.updateModalOpen);
                setUpToDateOpen(false);
              } else {
                setUpToDateOpen(true);
                get().setUpdateModalOpen(false);
              }
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
          </Button>
        </div>
      </div>

      {upToDateOpen && (
        <UpToDateDialog onClose={closeUpToDate} onCheckForUpdates={handleManualCheck} t={t} />
      )}
    </footer>
  );
}
