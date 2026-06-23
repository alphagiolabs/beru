/** Mini UI preview for a theme token set. */
export default function ThemePreviewCard({ tokens, compact = false, className = "" }) {
  if (!tokens) return null;

  return (
    <div
      className={`theme-preview-card ${compact ? "theme-preview-card--compact" : ""} ${className}`.trim()}
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
          <span style={{ color: tokens.textPrimary }}>Aa</span>
          <span className="theme-preview-card-dot" style={{ background: tokens.accentBrand }} />
        </div>
        <div className="theme-preview-card-body">
          <span style={{ color: tokens.textPrimary }}>Title</span>
          <span style={{ color: tokens.textSecondary }}>Subtitle</span>
          <div className="theme-preview-card-actions">
            <span
              className="theme-preview-card-btn"
              style={{
                background: tokens.accentBrand,
                color: tokens.bgApp,
              }}
            >
              OK
            </span>
            <span
              className="theme-preview-card-btn theme-preview-card-btn--ghost"
              style={{
                color: tokens.textSecondary,
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
