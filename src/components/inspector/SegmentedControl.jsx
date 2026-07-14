/**
 * iOS / macOS-style segmented control. Props-only — no store knowledge.
 * Equal-width segments + CSS-driven sliding thumb (no layout measurement).
 */
export default function SegmentedControl({
  options = [],
  value,
  onChange,
  ariaLabel,
  size = "md",
}) {
  const count = Math.max(options.length, 1);
  const index = Math.max(
    0,
    options.findIndex((opt) => opt.id === value),
  );

  return (
    <div
      className={`inspector-segmented inspector-segmented--${size}`}
      role="radiogroup"
      aria-label={ariaLabel}
      data-value={value}
      style={{
        "--seg-count": count,
        "--seg-index": index,
      }}
    >
      <span className="inspector-segment-thumb" aria-hidden />
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={opt.disabled}
            className={["inspector-segment", selected ? "is-selected" : ""]
              .filter(Boolean)
              .join(" ")}
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
