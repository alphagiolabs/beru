export async function runWithConcurrency(items, limit, worker, fallback) {
  const results = new Array(items.length);
  let cursor = 0;
  const launch = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
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
