import { useT } from "../../i18n/useT.js";
import { Select } from "../ui/select";
import DraftNumberInput from "../DraftNumberInput";
export default function CompositionCanvas({ document, locked, settings }) {
  const t = useT(),
    fpsValues = [24, 25, 30, 50, 60];
  if (document && !fpsValues.includes(document.fps)) fpsValues.push(document.fps);
  return (
    <>
      {document && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px]">
            {t("composition.width")}
            <DraftNumberInput
              className="cap-input w-full"
              aria-label={t("composition.width")}
              value={document.canvas.width}
              min={16}
              max={4096}
              step={2}
              disabled={locked}
              onCommit={(value) => settings({ canvas: { ...document.canvas, width: value } })}
            />
          </label>
          <label className="text-[11px]">
            {t("composition.height")}
            <DraftNumberInput
              className="cap-input w-full"
              aria-label={t("composition.height")}
              value={document.canvas.height}
              min={16}
              max={4096}
              step={2}
              disabled={locked}
              onCommit={(value) =>
                settings({
                  canvas: { ...document.canvas, height: value },
                })
              }
            />
          </label>
          <label className="text-[11px]">
            {t("composition.fps")}
            <Select
              aria-label={t("composition.fps")}
              disabled={locked}
              value={String(document.fps)}
              options={fpsValues
                .sort((a, b) => a - b)
                .map((fps) => ({ value: String(fps), label: String(fps) }))}
              onValueChange={(fps) => settings({ fps: Number(fps) })}
            />
          </label>
          <label className="text-[11px]">
            {t("composition.fit")}
            <Select
              aria-label={t("composition.fit")}
              disabled={locked}
              value={document.canvas.fit}
              options={[
                { value: "contain", label: t("composition.contain") },
                { value: "cover", label: t("composition.cover") },
              ]}
              onValueChange={(fit) => settings({ canvas: { ...document.canvas, fit } })}
            />
          </label>
        </div>
      )}
    </>
  );
}
