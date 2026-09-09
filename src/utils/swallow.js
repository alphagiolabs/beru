export function swallow(label, error) {
  const msg = error?.message || String(error);
  console.warn(`[beru] ${label} failed (non-critical):`, msg);
}
