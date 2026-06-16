/* Safe localStorage wrapper that degrades gracefully when storage is
 * unavailable (sandboxed renderer, private mode, disabled cookies, etc.).
 *
 * Used by the updater flow to persist the last-check timestamp and the
 * dismissed-version marker without crashing on access errors.
 */
export const safeStorage = {
  get(key) {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch {}
  },
};
