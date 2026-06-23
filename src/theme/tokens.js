/** Semantic theme token keys — map 1:1 to CSS custom properties. */
export const THEME_TOKEN_KEYS = [
  "bgApp",
  "bgSurface",
  "bgElevated",
  "textPrimary",
  "textSecondary",
  "textDim",
  "accent",
  "accentBrand",
  "accentBrandDim",
  "amber",
  "rose",
  "purple",
  "border",
  "overlay",
  "modalShadow",
];

export const CSS_VAR_MAP = {
  bgApp: "--bg-app",
  bgSurface: "--bg-surface",
  bgElevated: "--bg-elevated",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textDim: "--text-dim",
  accent: "--accent",
  accentBrand: "--accent-brand",
  accentBrandDim: "--accent-brand-dim",
  amber: "--amber",
  rose: "--rose",
  purple: "--purple",
  border: "--border",
  overlay: "--overlay",
  modalShadow: "--modal-shadow",
};

/** i18n key suffix for each token label in the theme editor. */
export const TOKEN_LABEL_KEYS = {
  bgApp: "theme.token.bgApp",
  bgSurface: "theme.token.bgSurface",
  bgElevated: "theme.token.bgElevated",
  textPrimary: "theme.token.textPrimary",
  textSecondary: "theme.token.textSecondary",
  textDim: "theme.token.textDim",
  accent: "theme.token.accent",
  accentBrand: "theme.token.accentBrand",
  accentBrandDim: "theme.token.accentBrandDim",
  amber: "theme.token.amber",
  rose: "theme.token.rose",
  purple: "theme.token.purple",
  border: "theme.token.border",
  overlay: "theme.token.overlay",
  modalShadow: "theme.token.modalShadow",
};

export const DEFAULT_SLOT1_PRESET = "beru-light";
export const DEFAULT_SLOT2_PRESET = "beru-dark";

export const CUSTOM_THEME_PREFIX = "custom:";
