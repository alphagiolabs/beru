export default function SegmentedControl({ options = [], value, onChange, ariaLabel }) {
  const count = Math.max(options.length, 1);
  const index = Math.max(
    0,
    options.findIndex((opt) => opt.id === value),
  );

  return (
    <div
      className="inspector-segmented"
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
