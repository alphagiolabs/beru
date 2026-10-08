const TERMINAL = new Set(["done", "error"]);

export function getBatchProgress({ queue, progressDone, progressTotal, jobProgress }) {
  const total = progressTotal > 0 ? progressTotal : queue.length;
  if (total <= 0) {
    return { completed: 0, total: 0, percent: 0 };
  }

  const fromQueue = queue.filter((q) => TERMINAL.has(q.status)).length;
  const completed = Math.max(Number(progressDone) || 0, fromQueue);

  let inFlight = 0;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (item.status !== "processing") continue;
    let p;
    if (jobProgress && Object.prototype.hasOwnProperty.call(jobProgress, i)) {
      p = Number(jobProgress[i]);
    } else {
      p = Number(item.progress);
    }
    if (Number.isFinite(p) && p > 0) {
      inFlight += Math.min(100, p) / 100;
    }
  }

  const maxInFlight = Math.max(0, total - completed);
  const fractional = completed + Math.min(inFlight, maxInFlight);
  const percent = Math.min(100, Math.round((fractional / total) * 1000) / 10);

  return { completed, total, percent };
}
