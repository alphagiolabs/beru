export async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const launch = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  };
  const runners = Array.from({ length: Math.min(limit, items.length) }, launch);
  await Promise.all(runners);
  return results;
}
