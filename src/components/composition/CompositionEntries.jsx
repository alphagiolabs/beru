import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { useT } from "../../i18n/useT.js";
import { Button } from "../ui/Button";
import { Select } from "../ui/select";
import { Tooltip } from "../ui/tooltip";
import DraftNumberInput from "../DraftNumberInput";
import { normalizeTiming, playbackRates } from "../../../shared/clip-timeline.js";
export default function CompositionEntries({
  document,
  selectedEntry,
  locked,
  onSelect,
  onMove,
  onRemove,
  edit,
}) {
  const t = useT(),
    item = selectedEntry?.item;
  const { rate, repeatCount } = normalizeTiming(item?.timing);
  const rates = playbackRates(rate);
  return (
    <div className="space-y-2">
      <ol className="space-y-1 max-h-[250px] overflow-y-auto" aria-label={t("composition.entries")}>
        {document?.entries.map((entry, index) => (
          <li
            key={entry.id}
            className="flex items-center gap-1 border-b border-[var(--border)] py-1"
          >
            <Button
              variant="tertiary"
              disabled={locked}
              className="flex-1 min-w-0 justify-start"
              aria-pressed={entry.id === selectedEntry?.id}
              onClick={() => onSelect(entry.id)}
            >
              <span className="truncate">
                {index + 1}. {entry.item.filename}
              </span>
            </Button>
            <Tooltip label={t("composition.moveUp", { name: entry.item.filename })}>
              <Button
                size="icon"
                variant="tertiary"
                disabled={locked || index === 0}
                aria-label={t("composition.moveUp", { name: entry.item.filename })}
                onClick={() => onMove(entry.id, -1)}
              >
                <ArrowUp size={14} />
              </Button>
            </Tooltip>
            <Tooltip label={t("composition.moveDown", { name: entry.item.filename })}>
              <Button
                size="icon"
                variant="tertiary"
                disabled={locked || index === document.entries.length - 1}
                aria-label={t("composition.moveDown", { name: entry.item.filename })}
                onClick={() => onMove(entry.id, 1)}
              >
                <ArrowDown size={14} />
              </Button>
            </Tooltip>
            <Tooltip label={t("composition.remove", { name: entry.item.filename })}>
              <Button
                size="icon"
                variant="tertiary"
                disabled={locked}
                aria-label={t("composition.remove", { name: entry.item.filename })}
                onClick={() => onRemove(entry.id)}
              >
                <Trash2 size={14} />
              </Button>
            </Tooltip>
          </li>
        ))}
      </ol>
      {!document?.entries.length && (
        <p className="text-[12px] text-[var(--text-secondary)]">{t("composition.empty")}</p>
      )}
      {item && (
        <>
          <p className="text-[11px] font-medium">{t("composition.localEdit")}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px]">
              {t("composition.trimStart")}
              <DraftNumberInput
                className="cap-input w-full"
                aria-label={t("composition.trimStart")}
                value={item.trimStart ?? 0}
                step={0.01}
                min={0}
                max={item.duration}
                disabled={locked}
                onCommit={(value) => edit({ trimStart: value })}
              />
            </label>
            <label className="text-[11px]">
              {t("composition.trimEnd")}
              <DraftNumberInput
                className="cap-input w-full"
                aria-label={t("composition.trimEnd")}
                value={item.trimEnd ?? item.duration}
                step={0.01}
                min={0}
                max={item.duration}
                disabled={locked}
                onCommit={(value) => edit({ trimEnd: value })}
              />
            </label>
            <label className="text-[11px]">
              {t("timing.rate")}
              <Select
                aria-label={t("composition.entryRate")}
                disabled={locked}
                value={String(rate)}
                options={rates.map((rate) => ({ value: String(rate), label: `${rate}×` }))}
                onValueChange={(rate) => edit({ timing: { ...item.timing, rate: Number(rate) } })}
              />
            </label>
            <label className="text-[11px]">
              {t("timing.repeat")}
              <Select
                aria-label={t("composition.entryRepeat")}
                disabled={locked}
                value={String(repeatCount)}
                options={Array.from({ length: 20 }, (_, i) => ({
                  value: String(i + 1),
                  label: String(i + 1),
                }))}
                onValueChange={(count) =>
                  edit({ timing: { ...item.timing, repeatCount: Number(count) } })
                }
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
