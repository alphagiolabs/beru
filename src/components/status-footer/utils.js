import { formatHistoryTimestamp } from "../../utils/execution-history";

export function formatRunTitle(run, t) {
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
