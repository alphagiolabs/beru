/**
 * iOS-style segmented control. Props-only — no store knowledge.
 * Uses radiogroup semantics for keyboard a11y.
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
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={opt.disabled}
            className={`inspector-segment${selected ? " is-selected" : ""}`}
            style={
              selected && opt.activeColor
                ? { background: opt.activeColor, color: opt.activeTextColor || "white" }
                : undefined
            }
            onClick={() => {
              if (!selected) onChange?.(opt.id);
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
