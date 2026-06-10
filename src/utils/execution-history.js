export const MAX_EXECUTION_RUNS = 40;
export const MAX_LINES_PER_RUN = 200;

export function createExecutionRun({ kind = "batch", jobCount = 0, startedAt = new Date() } = {}) {
  const ts = startedAt instanceof Date ? startedAt : new Date(startedAt);
  return {
    id: `${ts.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: ts.toISOString(),
    finishedAt: null,
    kind: kind === "single" ? "single" : "batch",
    jobCount: Math.max(0, Number(jobCount) || 0),
    summary: null,
    lines: [],
  };
}

export function normalizeExecutionHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((run) => run && typeof run.id === "string" && typeof run.startedAt === "string")
    .map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      finishedAt: typeof run.finishedAt === "string" ? run.finishedAt : null,
      kind: run.kind === "single" ? "single" : "batch",
      jobCount: Math.max(0, Number(run.jobCount) || 0),
      summary:
        run.summary && typeof run.summary === "object"
          ? {
              total: Math.max(0, Number(run.summary.total) || 0),
              succeeded: Math.max(0, Number(run.summary.succeeded) || 0),
              failed: Math.max(0, Number(run.summary.failed) || 0),
            }
          : null,
      lines: Array.isArray(run.lines)
        ? run.lines.filter((line) => typeof line === "string").slice(-MAX_LINES_PER_RUN)
        : [],
    }))
    .slice(0, MAX_EXECUTION_RUNS);
}

export function prependExecutionRun(history, run) {
  return normalizeExecutionHistory([run, ...(Array.isArray(history) ? history : [])]).slice(
    0,
    MAX_EXECUTION_RUNS,
  );
}

export function appendLineToRun(history, runId, line, limit = MAX_LINES_PER_RUN) {
  const nextLine = typeof line === "string" ? line : JSON.stringify(line);
  let changed = false;
  const next = (Array.isArray(history) ? history : []).map((run) => {
    if (run.id !== runId) return run;
    changed = true;
    return {
      ...run,
      lines: [...run.lines, nextLine].slice(-limit),
    };
  });
  return changed ? next : history;
}

export function finalizeExecutionRun(history, runId, summary, finishedAt = new Date()) {
  const ts = finishedAt instanceof Date ? finishedAt : new Date(finishedAt);
  let changed = false;
  const next = (Array.isArray(history) ? history : []).map((run) => {
    if (run.id !== runId || run.finishedAt) return run;
    changed = true;
    return {
      ...run,
      finishedAt: ts.toISOString(),
      summary:
        summary && typeof summary === "object"
          ? {
              total: Math.max(0, Number(summary.total) || 0),
              succeeded: Math.max(0, Number(summary.succeeded) || 0),
              failed: Math.max(0, Number(summary.failed) || 0),
            }
          : run.summary,
    };
  });
  return changed ? next : history;
}

export function flattenExecutionHistory(history) {
  const runs = normalizeExecutionHistory(history);
  const lines = [];
  for (const run of runs) {
    lines.push(formatRunHeader(run));
    lines.push(...run.lines);
    if (run.lines.length > 0) lines.push("");
  }
  return lines.filter((line, idx, arr) => line !== "" || arr[idx - 1] !== "");
}

export function formatRunHeader(run) {
  const started = formatHistoryTimestamp(run.startedAt);
  const kindLabel = run.kind === "single" ? "Prueba" : "Lote";
  const jobs = run.jobCount > 0 ? `${run.jobCount} job${run.jobCount === 1 ? "" : "s"}` : kindLabel;
  if (run.summary) {
    return `── ${started} · ${jobs} · ${run.summary.succeeded}/${run.summary.total} ok${
      run.summary.failed > 0 ? ` · ${run.summary.failed} err` : ""
    } ──`;
  }
  if (run.finishedAt) return `── ${started} · ${jobs} · finalizado ──`;
  return `── ${started} · ${jobs} · en curso ──`;
}

export function formatHistoryTimestamp(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function summarizeQueue(queue = []) {
  const terminal = queue.filter((item) => item.status === "done" || item.status === "error");
  if (terminal.length === 0) return null;
  return {
    total: terminal.length,
    succeeded: terminal.filter((item) => item.status === "done").length,
    failed: terminal.filter((item) => item.status === "error").length,
  };
}

export function formatExecutionHistoryExport(history, meta = {}) {
  const lines = flattenExecutionHistory(history);
  const header = [
    "Beru execution history",
    `Exported: ${meta.exportedAt || new Date().toISOString()}`,
    meta.summary ? `Summary: ${meta.summary}` : null,
    "",
  ].filter((line) => line !== null);
  return [...header, ...lines].join("\n");
}
