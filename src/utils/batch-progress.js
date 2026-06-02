const TERMINAL = new Set(["done", "error"]);

/**
 * Overall batch bar: finished jobs plus fractional credit for in-flight encodes.
 * @returns {{ completed: number, total: number, percent: number }}
 */
export function getBatchProgress({ queue, progressDone, progressTotal }) {
  const total = progressTotal > 0 ? progressTotal : queue.length;
  if (total <= 0) {
    return { completed: 0, total: 0, percent: 0 };
  }

  const fromQueue = queue.filter((q) => TERMINAL.has(q.status)).length;
  const completed = Math.max(Number(progressDone) || 0, fromQueue);

  let inFlight = 0;
  for (const item of queue) {
    if (item.status !== "processing") continue;
    const p = Number(item.progress);
    if (Number.isFinite(p) && p > 0) {
      inFlight += Math.min(100, Math.max(0, p)) / 100;
    }
  }

  const maxInFlight = Math.max(0, total - completed);
  const fractional = completed + Math.min(inFlight, maxInFlight);
  const percent = Math.min(100, Math.round((fractional / total) * 1000) / 10);

  return { completed, total, percent };
}