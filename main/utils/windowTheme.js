/** Window chrome colors — kept in sync with src/index.css theme tokens. */
export const WINDOW_THEME = {
  dark: {
    background: "#0a0a0a",
    symbols: "#ffffff",
  },
  light: {
    background: "#f5f5f5",
    symbols: "#0a0a0a",
  },
};

/**
 * Fully transparent WCO background so the renderer titlebar region shows through.
 * Using alpha=0 avoids Electron painting a separate caption color on Windows.
 * Fallback note: if a platform ignores #00000000, use #01000000 (see electron#51014).
 */
export const TITLEBAR_OVERLAY_COLOR = "#00000000";

export function resolveWindowTheme(theme) {
  return theme === "light" ? WINDOW_THEME.light : WINDOW_THEME.dark;
}

export function applyWindowTheme(win, theme) {
  if (!win || win.isDestroyed()) return;
  const colors = resolveWindowTheme(theme);
  win.setBackgroundColor(colors.background);
  if (process.platform === "win32" || process.platform === "darwin") {
    try {
      win.setTitleBarOverlay({
        color: TITLEBAR_OVERLAY_COLOR,
        symbolColor: colors.symbols,
        height: 32,
      });
    } catch {}
  }
}
