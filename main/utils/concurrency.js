export async function runWithConcurrency(items, limit, worker, shouldCancel) {
  const results = new Array(items.length);
  let cursor = 0;
  let cancelled = false;
  const launch = async () => {
    while (true) {
      if (cancelled) return;
      const idx = cursor++;
      if (idx >= items.length) return;
      if (shouldCancel && shouldCancel()) {
        cancelled = true;
        return;
      }
      results[idx] = await worker(items[idx], idx);
    }
  };
  const runners = Array.from({ length: Math.min(limit, items.length) }, launch);
  await Promise.all(runners);
  return results;
}
