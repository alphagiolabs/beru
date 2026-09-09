export async function runWithConcurrency(items, limit, worker, fallback, shouldCancel) {
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
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        if (fallback) {
          results[idx] = fallback(err, items[idx], idx);
        } else {
          throw err;
        }
      }
    }
  };
  const runners = Array.from({ length: Math.min(limit, items.length) }, launch);
  await Promise.all(runners);
  return results;
}
