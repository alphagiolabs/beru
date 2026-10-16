import {
  Upload,
  X,
  Timer,
  FlipHorizontal2,
  Grid3x3,
  Sparkles,
  Droplet,
  PaintBucket,
} from "lucide-react";
import { imageVersion } from "../utils/beru-url";
import { DELOGO_METHODS, MIRROR_SIDES } from "../utils/types";
import { storeErrorText } from "../utils/store-errors";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import DelogoMethodHelp from "./DelogoMethodHelp";
import HistoryRange from "./HistoryRange.jsx";

const DELOGO_ICONS = {
  temporal: Timer,
  mirror: FlipHorizontal2,
  mosaic: Grid3x3,
  inpaint: Sparkles,
  blur: Droplet,
  fill: PaintBucket,
};
function DelogoMethodPicker({ method, onPatch, draft = false }) {
  const t = useT();
  return (
    <TooltipProvider>
      <div className={`delogo-method-grid grid grid-cols-3 gap-1${draft ? " mt-2" : ""}`}>
        {DELOGO_METHODS.map((m) => {
          const Icon = DELOGO_ICONS[m.id];
          const active = method === m.id;
          return (
            <Tooltip key={m.id} label={t(m.labelKey)} description={t(m.descriptionKey)}>
              <button
                type="button"
                onClick={() => onPatch({ delogoMethod: m.id })}
                className={`inspector-chip${draft ? " flex-col gap-0.5 !min-h-[40px]" : " !min-h-[32px]"}${active ? " is-selected" : ""}`}
                style={
                  active
                    ? {
                        background: "var(--rose)",
                        color: "var(--text-on-rose)",
                        borderColor: "var(--rose)",
                      }
                    : undefined
                }
              >
                {draft && Icon && <Icon size={11} />}
                <span className="text-[10px]">{t(m.labelKey)}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function CoverPicker({ op, onPatch, draft }) {
  const t = useT();
  const get = useEditorStore.getState;
  return (
    <div>
      <span className="cap-input-label">{t(draft ? "props.coverImage" : "logo.coverImage")}</span>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={op.delogoImagePath ? op.delogoImagePath.split(/[\\/]/).pop() : ""}
          placeholder={t("logo.coverImagePlaceholder")}
          readOnly
          className="cap-input flex-1 font-mono text-[10px] truncate"
        />
        <Button
          type="button"
          onClick={async () => {
            const res = await window.api?.pickImage();
            if (res?.success) {
              const r = await window.api?.statImage(res.path);
              onPatch({
                delogoImagePath: res.path,
                delogoImageV: r?.success ? imageVersion(r) : "",
              });
            } else if (res && !res.canceled) {
              get().showToast?.({
                kind: "err",
                text: storeErrorText(t, res, "errors.imageReadFailed"),
              });
            }
          }}
          variant="secondary"
          size="sm"
          className="!text-[10px] !px-2"
        >
          <Upload size={12} /> {t("logo.pick")}
        </Button>
        {op.delogoImagePath && (
          <Button
            type="button"
            onClick={() => onPatch({ delogoImagePath: "", delogoImageV: "" })}
            variant="tertiary"
            size="icon"
            className="text-[var(--rose)]"
            style={{ color: "var(--text-rose)" }}
            title={t("common.remove")}
            aria-label={t("common.remove")}
          >
            <X size={12} />
          </Button>
        )}
      </div>
      {draft && !op.delogoImagePath && (
        <p className="inspector-helper mt-1" style={{ color: "var(--text-rose)" }}>
          {t("props.coverFallbackHint", { method: t("catalog.delogoMethod.blur") })}
        </p>
      )}
    </div>
  );
}

export function DelogoFields({ op, onPatch, variant = "applied" }) {
  const t = useT();
  const method = op.delogoMethod || "blur";
  const draft = variant === "draft";
  return (
    <div className="space-y-2">
      {draft ? (
        <details className="mt-2" open={method !== "blur" || undefined}>
          <summary className="inspector-helper cursor-pointer">{t("logo.advancedMethods")}</summary>
          <DelogoMethodPicker method={method} onPatch={onPatch} draft />
        </details>
      ) : (
        <>
          <span className="cap-input-label">{t("props.method")}</span>
          <DelogoMethodPicker method={method} onPatch={onPatch} />
        </>
      )}
      <DelogoMethodHelp methodId={method} />

      {method === "blur" && (
        <div
          className="flex items-center gap-2 text-[11px] min-w-0"
          style={{ color: "var(--text-dim)" }}
        >
          {t("props.intensity")}
          <HistoryRange
            owner={op.id}
            min="2"
            max="60"
            value={op.blurStrength ?? 20}
            onValueChange={(value, options) => onPatch({ blurStrength: value }, options)}
            className="inspector-range"
            aria-label={t("logo.blurIntensity")}
          />
          <span
            className="font-mono text-xs w-8 flex-shrink-0 text-right"
            style={{ color: "var(--text-brand)" }}
          >
            {op.blurStrength ?? 20}
          </span>
        </div>
      )}

      {method === "temporal" && (
        <div
          className="flex items-center gap-2 text-[11px] min-w-0"
          style={{ color: "var(--text-dim)" }}
        >
          {t("props.radiusFrames")}
          <HistoryRange
            owner={op.id}
            min="1"
            max="15"
            value={op.temporalRadius ?? 3}
            onValueChange={(value, options) => onPatch({ temporalRadius: value }, options)}
            className="inspector-range"
            aria-label={t("logo.temporalRadius")}
          />
          <span
            className="font-mono text-xs w-8 flex-shrink-0 text-right"
            style={{ color: "var(--text-brand)" }}
          >
            {op.temporalRadius ?? 3}
          </span>
        </div>
      )}

      {method === "mosaic" && (
        <div
          className="flex items-center gap-2 text-[11px] min-w-0"
          style={{ color: "var(--text-dim)" }}
        >
          {t("props.blockSize")}
          <HistoryRange
            owner={op.id}
            min="4"
            max="40"
            value={op.mosaicSize ?? 12}
            onValueChange={(value, options) => onPatch({ mosaicSize: value }, options)}
            className="inspector-range"
            aria-label={t("logo.mosaicBlockSize")}
          />
          <span
            className="font-mono text-xs w-8 flex-shrink-0 text-right"
            style={{ color: "var(--text-brand)" }}
          >
            {op.mosaicSize ?? 12}px
          </span>
        </div>
      )}

      {method === "mirror" && (
        <div>
          <span className="cap-input-label">{t("props.mirrorSide")}</span>
          <div className="grid grid-cols-2 gap-1">
            {MIRROR_SIDES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPatch({ mirrorSide: s.id })}
                className={`inspector-chip${(op.mirrorSide || "right") === s.id ? " is-selected" : ""}`}
                style={
                  (op.mirrorSide || "right") === s.id
                    ? {
                        background: "var(--rose)",
                        color: "var(--text-on-rose)",
                        borderColor: "var(--rose)",
                      }
                    : undefined
                }
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {method === "fill" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span className="cap-input-label !mb-0">{t("table.color")}</span>
            <input
              type="color"
              value={op.delogoFillColor || "#000000"}
              onChange={(e) => onPatch({ delogoFillColor: e.target.value })}
              className="w-6 h-6 rounded cursor-pointer border-0"
              aria-label={t("logo.fillColor")}
            />
            {draft && (
              <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                {op.delogoFillColor}
              </span>
            )}
          </label>
          <div
            className="flex items-center gap-2 text-[11px] min-w-0"
            style={{ color: "var(--text-dim)" }}
          >
            {t("table.opacity")}
            <HistoryRange
              owner={op.id}
              min="0"
              max="1"
              step="0.05"
              value={op.delogoFillOpacity ?? 1}
              onValueChange={(value, options) => onPatch({ delogoFillOpacity: value }, options)}
              className="inspector-range"
              aria-label={t("logo.fillOpacity")}
            />
            <span
              className="font-mono text-xs w-8 flex-shrink-0 text-right"
              style={{ color: "var(--text-brand)" }}
            >
              {Number(op.delogoFillOpacity ?? 1).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {method === "cover" && <CoverPicker op={op} onPatch={onPatch} draft={draft} />}

      <div
        className="flex items-center gap-2 text-[11px] min-w-0"
        style={{ color: "var(--text-dim)" }}
      >
        <span title={t("logo.edgeFeatherHint")}>{t("logo.edgeFeather")}</span>
        <HistoryRange
          owner={op.id}
          min="0"
          max="20"
          value={op.edgeFeather ?? 6}
          onValueChange={(value, options) => onPatch({ edgeFeather: value }, options)}
          className="inspector-range"
          aria-label={t("logo.edgeFeather")}
        />
        <span className="font-mono text-xs w-8 text-right" style={{ color: "var(--text-brand)" }}>
          {op.edgeFeather ?? 6}px
        </span>
      </div>
    </div>
  );
}
