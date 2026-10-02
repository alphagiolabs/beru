export function trimOldest(cache, max) {
  for (const key of cache.keys()) {
    if (cache.size <= max) break;
    cache.delete(key);
  }
}
