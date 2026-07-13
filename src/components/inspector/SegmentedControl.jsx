/**
 * iOS / macOS-style segmented control. Props-only — no store knowledge.
 * Uses radiogroup semantics for keyboard a11y.
 *
 * Optional per-option `tone`: "accent" | "purple" | "neutral" (default elevated pill).
 */
export default function SegmentedControl({
  options = [],
  value,
  onChange,
  ariaLabel,
  size = "md",
}) {
  return (
    <div
      className={`inspector-segmented inspector-segmented--${size}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const selected = value === opt.id;
        const tone = opt.tone || (opt.activeColor ? "custom" : "neutral");
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={opt.disabled}
            className={[
              "inspector-segment",
              selected ? "is-selected" : "",
              selected ? `is-tone-${tone}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={
              selected && tone === "custom" && opt.activeColor
                ? {
                    background: opt.activeColor,
                    color: opt.activeTextColor || "#ffffff",
                  }
                : undefined
            }
            onClick={() => {
              if (!selected && !opt.disabled) onChange?.(opt.id);
            }}
          >
            <span className="inspector-segment-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
