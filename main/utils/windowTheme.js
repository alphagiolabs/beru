/** Window chrome colors — kept in sync with src/index.css theme tokens. */
export const WINDOW_THEME = {
  dark: {
    background: "#0a0a0a",
    overlay: "#1a1a1a",
    symbols: "#ffffff",
  },
  light: {
    background: "#f5f5f5",
    overlay: "#ffffff",
    symbols: "#0a0a0a",
  },
};

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
        color: colors.overlay,
        symbolColor: colors.symbols,
        height: 32,
      });
    } catch {}
  }
}
