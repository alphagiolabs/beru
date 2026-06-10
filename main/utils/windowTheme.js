/** Window chrome colors — kept in sync with src/index.css theme tokens. */
export const WINDOW_THEME = {
  dark: {
    background: "#0a0a0a",
    elevated: "#1a1a1a",
    symbols: "#ffffff",
  },
  light: {
    background: "#f5f5f5",
    elevated: "#ffffff",
    symbols: "#0a0a0a",
  },
};

/** @typedef {"app" | "elevated"} TitleBarChrome */

/** @type {TitleBarChrome} */
let titleBarChrome = "app";

export function resolveWindowTheme(theme) {
  return theme === "light" ? WINDOW_THEME.light : WINDOW_THEME.dark;
}

export function resolveTitleBarOverlayColor(theme, chrome = titleBarChrome) {
  const colors = resolveWindowTheme(theme);
  return chrome === "elevated" ? colors.elevated : colors.background;
}

export function setTitleBarChrome(chrome) {
  titleBarChrome = chrome === "elevated" ? "elevated" : "app";
}

export function getTitleBarChrome() {
  return titleBarChrome;
}

export function applyWindowTheme(win, theme, chrome = titleBarChrome) {
  if (!win || win.isDestroyed()) return;
  setTitleBarChrome(chrome);
  const colors = resolveWindowTheme(theme);
  win.setBackgroundColor(colors.background);
  if (process.platform === "win32" || process.platform === "darwin") {
    try {
      win.setTitleBarOverlay({
        color: resolveTitleBarOverlayColor(theme, chrome),
        symbolColor: colors.symbols,
        height: 32,
      });
    } catch {}
  }
}
