/**
 * Compact chip/toolbar row for align, weight, etc.
 * Single selected-language: soft accent fill.
 */
export default function SegmentedToolbar({
  options = [],
  value,
  onChange,
  columns,
  ariaLabel,
  disabled = false,
}) {
  const cols = columns || options.length || 1;

  return (
    <div
      className="inspector-toolbar"
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || opt.disabled}
            title={opt.title || opt.label}
            aria-label={opt.ariaLabel || opt.title || opt.label}
            className={`inspector-chip${selected ? " is-selected" : ""}`}
            style={opt.style}
            onClick={() => {
              if (!selected) onChange?.(opt.value);
            }}
          >
            {opt.icon || opt.label}
          </button>
        );
      })}
    </div>
  );
}
