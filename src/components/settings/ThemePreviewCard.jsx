import { getThemeTextColors } from "../../theme/contrast.js";

export default function ThemePreviewCard({ tokens, className = "" }) {
  if (!tokens) return null;
  const text = getThemeTextColors(tokens);

  return (
    <div
      className={`theme-preview-card ${className}`.trim()}
      style={{
        background: tokens.bgApp,
        borderColor: tokens.border,
      }}
    >
      <div
        className="theme-preview-card-surface"
        style={{ background: tokens.bgSurface, borderColor: tokens.border }}
      >
        <div className="theme-preview-card-bar" style={{ background: tokens.bgElevated }}>
          <span style={{ color: text.textPrimary }}>Aa</span>
          <span className="theme-preview-card-dot" style={{ background: tokens.accentBrand }} />
        </div>
        <div className="theme-preview-card-body">
          <span style={{ color: text.textPrimary }}>Title</span>
          <span style={{ color: text.textSecondary }}>Subtitle</span>
          <div className="theme-preview-card-actions">
            <span
              className="theme-preview-card-btn"
              style={{
                background: tokens.accentBrand,
                color: text.onBrand,
              }}
            >
              OK
            </span>
            <span
              className="theme-preview-card-btn theme-preview-card-btn--ghost"
              style={{
                color: text.textSecondary,
                borderColor: tokens.border,
              }}
            >
              ···
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
