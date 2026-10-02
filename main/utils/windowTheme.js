const WINDOW_THEME = {
  dark: {
    background: "#0a0a0a",
    symbols: "#ffffff",
  },
  light: {
    background: "#f5f5f5",
    symbols: "#0a0a0a",
  },
};

export const TITLEBAR_OVERLAY_COLOR = "#00000000";
export const TITLEBAR_OVERLAY_HEIGHT = 40;

export function resolveWindowTheme(themeOrColors) {
  if (themeOrColors && typeof themeOrColors === "object" && themeOrColors.background) {
    return {
      background: themeOrColors.background,
      symbols: themeOrColors.symbols || "#ffffff",
    };
  }
  return themeOrColors === "light" ? WINDOW_THEME.light : WINDOW_THEME.dark;
}

export function applyWindowTheme(win, themeOrColors) {
  if (!win || win.isDestroyed()) return;
  const colors = resolveWindowTheme(themeOrColors);
  win.setBackgroundColor(colors.background);
  try {
    win.setTitleBarOverlay({
      color: TITLEBAR_OVERLAY_COLOR,
      symbolColor: colors.symbols,
      height: TITLEBAR_OVERLAY_HEIGHT,
    });
  } catch {}
}
