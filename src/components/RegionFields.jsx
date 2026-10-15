import DraftNumberInput from "./DraftNumberInput";
import { regionFromFieldPixels } from "../utils/region-interaction";

const FIELDS = [
  ["X", "x"],
  ["Y", "y"],
  ["W", "w"],
  ["H", "h"],
];

const VARIANTS = {
  strip: {
    cell: "inspector-region-cell",
    key: "inspector-region-cell-key",
    input: "inspector-region-cell-input",
  },
  applied: {
    cell: undefined,
    key: "cap-input-label",
    input: "cap-input inspector-number-input font-mono text-[11px]",
  },
};

export default function RegionFields({ region, dims, variant, onRegionChange }) {
  const classes = VARIANTS[variant];
  const ready = dims.w > 0 && dims.h > 0;
  return (
    <>
      {FIELDS.map(([label, key]) => {
        const dim = key === "x" || key === "w" ? dims.w : dims.h;
        return (
          <label key={key} className={classes.cell}>
            <span className={classes.key}>{label}</span>
            <DraftNumberInput
              aria-label={label}
              inputMode="numeric"
              value={ready ? Math.round((region[key] || 0) * dim) : ""}
              disabled={!ready}
              min={0}
              largeStep={10}
              onCommit={(px, options) => {
                const next = regionFromFieldPixels(region, key, px, dims);
                if (!next || FIELDS.every(([, k]) => next[k] === region[k])) return false;
                onRegionChange(next, options);
              }}
              className={classes.input}
            />
          </label>
        );
      })}
    </>
  );
}
