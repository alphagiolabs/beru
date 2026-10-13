import { fitRegionToAspect } from "../utils/region-interaction";
import { frameAfterCrops } from "../utils/crop-output";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";

// Mirrors the Processor: a crop without a time window changes the output size, rounded to even.
export default function CropRatioPresets({ region, dims, timed, operations, onRegionChange }) {
  const t = useT();
  const ready = !!region && dims.w > 0 && dims.h > 0;
  const presets = [
    { id: "original", label: t("logo.cropRatioOriginal"), aspect: ready ? dims.w / dims.h : 0 },
    { id: "1:1", label: "1:1", aspect: 1 },
    { id: "16:9", label: "16:9", aspect: 16 / 9 },
    { id: "9:16", label: "9:16", aspect: 9 / 16 },
  ];
  const output = ready ? frameAfterCrops(operations, dims) : { width: 0, height: 0 };

  return (
    <div className="space-y-1.5">
      <span className="cap-input-label">{t("logo.cropRatio")}</span>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("logo.cropRatio")}>
        {presets.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            variant="secondary"
            size="sm"
            disabled={!ready}
            className="w-full !text-[10px]"
            onClick={() => {
              const next = fitRegionToAspect(region, preset.aspect, dims);
              if (next) onRegionChange(next);
            }}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <p className="inspector-helper">
        {timed
          ? t("logo.cropTemporalHint")
          : t("logo.cropPermanentHint", { w: output.width, h: output.height })}
      </p>
    </div>
  );
}
