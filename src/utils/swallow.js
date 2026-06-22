/**
 * Utility for safely swallowing non-critical errors with a debug label.
 * Use this instead of bare `catch {}` blocks so errors are at least visible
 * in the console during development without disrupting the user.
 *
 * Usage:
 *   // Before: try { await api.saveSettings(x) } catch {}
 *   // After:  try { await api.saveSettings(x) } catch (e) { swallow("saveSettings", e) }
 *
 * @param {string} label - short description of the operation that failed
 * @param {unknown} error - the caught error
 */
export function swallow(label, error) {
  const msg = error?.message || String(error);
  console.warn(`[beru] ${label} failed (non-critical):`, msg);
}
