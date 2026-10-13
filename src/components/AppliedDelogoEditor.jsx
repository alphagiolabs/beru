import { Upload, X } from "lucide-react";
import { imageVersion } from "../utils/beru-url";
import { DELOGO_METHODS, MIRROR_SIDES } from "../utils/types";
import { storeErrorText } from "../utils/store-errors";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import RegionFields from "./RegionFields";
import TimeRangeFields from "./TimeRangeFields";
import CropRatioPresets from "./CropRatioPresets";
import DelogoMethodHelp from "./DelogoMethodHelp";
import { Tooltip, TooltipProvider } from "./ui/tooltip";

const TITLE_KEYS = {
  blur: "props.appliedBlur",
  delogo: "props.appliedDelogo",
  crop: "props.appliedCrop",
};

function CoverPicker({ op, onPatch }) {
  const t = useT();
  const get = useEditorStore.getState;
  return (
    <div>
      <span className="cap-input-label">{t("logo.coverImage")}</span>
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
    </div>
  );
}

function DelogoFields({ op, onPatch }) {
  const t = useT();
  const method = op.delogoMethod || "blur";
  return (
    <div className="space-y-2">
      <span className="cap-input-label">{t("props.method")}</span>
      <TooltipProvider>
        <div className="delogo-method-grid grid grid-cols-3 gap-1">
          {DELOGO_METHODS.map((m) => {
            const active = method === m.id;
            return (
              <Tooltip key={m.id} label={t(m.labelKey)} description={t(m.descriptionKey)}>
                <button
                  type="button"
                  onClick={() => onPatch({ delogoMethod: m.id })}
                  className={`inspector-chip !min-h-[32px]${active ? " is-selected" : ""}`}
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
                  <span className="text-[10px]">{t(m.labelKey)}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      <DelogoMethodHelp methodId={method} />

      {method === "blur" && (
        <div
          className="flex items-center gap-2 text-[11px] min-w-0"
          style={{ color: "var(--text-dim)" }}
        >
          {t("props.intensity")}
          <input
            type="range"
            min="2"
            max="60"
            value={op.blurStrength ?? 20}
            onChange={(e) => onPatch({ blurStrength: Number(e.target.value) })}
            className="inspector-range"
            aria-label={t("logo.blurIntensity")}
          />
          <span className="font-mono text-xs w-6 text-right" style={{ color: "var(--text-brand)" }}>
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
          <input
            type="range"
            min="1"
            max="15"
            value={op.temporalRadius ?? 3}
            onChange={(e) => onPatch({ temporalRadius: Number(e.target.value) })}
            className="inspector-range"
            aria-label={t("logo.temporalRadius")}
          />
          <span className="font-mono text-xs w-6 text-right" style={{ color: "var(--text-brand)" }}>
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
          <input
            type="range"
            min="4"
            max="40"
            value={op.mosaicSize ?? 12}
            onChange={(e) => onPatch({ mosaicSize: Number(e.target.value) })}
            className="inspector-range"
            aria-label={t("logo.mosaicBlockSize")}
          />
          <span className="font-mono text-xs w-6 text-right" style={{ color: "var(--text-brand)" }}>
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
          </label>
          <div
            className="flex items-center gap-2 text-[11px] min-w-0"
            style={{ color: "var(--text-dim)" }}
          >
            {t("table.opacity")}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={op.delogoFillOpacity ?? 1}
              onChange={(e) => onPatch({ delogoFillOpacity: Number(e.target.value) })}
              className="inspector-range"
              aria-label={t("logo.fillOpacity")}
            />
            <span
              className="font-mono text-xs w-6 text-right"
              style={{ color: "var(--text-brand)" }}
            >
              {Number(op.delogoFillOpacity ?? 1).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {method === "cover" && <CoverPicker op={op} onPatch={onPatch} />}

      <div
        className="flex items-center gap-2 text-[11px] min-w-0"
        style={{ color: "var(--text-dim)" }}
      >
        <span title={t("logo.edgeFeatherHint")}>{t("logo.edgeFeather")}</span>
        <input
          type="range"
          min="0"
          max="20"
          value={op.edgeFeather ?? 6}
          onChange={(e) => onPatch({ edgeFeather: Number(e.target.value) })}
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

function ImageFields({ op, onPatch }) {
  const t = useT();
  const get = useEditorStore.getState;
  return (
    <div className="space-y-2">
      <div>
        <span className="cap-input-label">{t("toolbar.image")}</span>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={op.imagePath ? op.imagePath.split(/[\\/]/).pop() : ""}
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
                  imagePath: res.path,
                  imageV: r?.success ? imageVersion(r) : "",
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
        </div>
      </div>
      <div
        className="flex items-center gap-2 text-[11px] min-w-0"
        style={{ color: "var(--text-dim)" }}
      >
        {t("table.opacity")}
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={op.imageOpacity ?? 1}
          onChange={(e) => onPatch({ imageOpacity: Number(e.target.value) })}
          className="inspector-range"
          aria-label={t("table.opacity")}
        />
        <span className="font-mono text-xs w-6 text-right" style={{ color: "var(--text-brand)" }}>
          {Number(op.imageOpacity ?? 1).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export default function AppliedDelogoEditor({ op, videoIdx, opIdx, video }) {
  const t = useT();
  if (!op || !["blur", "delogo", "crop", "image"].includes(op.mode)) return null;
  const get = useEditorStore.getState;
  const dims = { w: video?.width || 0, h: video?.height || 0 };
  const region = op.region || { x: 0, y: 0, w: 0.2, h: 0.2 };
  const onPatch = (patch, options) => get().updateOperation(videoIdx, opIdx, patch, options);
  const onPatchRegion = (next, options) =>
    get().updateOperation(videoIdx, opIdx, { region: next }, options);

  return (
    <div className="space-y-2.5" data-applied-region-editor={op.mode}>
      <div className="cap-section-title">
        {TITLE_KEYS[op.mode] ? t(TITLE_KEYS[op.mode]) : t("props.appliedImage")}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <RegionFields
          region={region}
          dims={dims}
          variant="applied"
          onRegionChange={onPatchRegion}
        />
      </div>

      {op.mode === "crop" && (
        <CropRatioPresets
          region={region}
          dims={dims}
          timed={op.startTime != null || op.endTime != null}
          operations={video?.operations?.slice(0, opIdx + 1) ?? []}
          onRegionChange={onPatchRegion}
        />
      )}

      {op.mode === "blur" && (
        <div
          className="flex items-center gap-2 text-[11px] min-w-0"
          style={{ color: "var(--text-dim)" }}
        >
          {t("props.intensity")}
          <input
            type="range"
            min="2"
            max="60"
            value={op.blurStrength ?? 20}
            onChange={(e) => onPatch({ blurStrength: Number(e.target.value) })}
            className="inspector-range"
            aria-label={t("logo.blurStrength")}
          />
          <span className="font-mono text-xs w-6 text-right" style={{ color: "var(--text-brand)" }}>
            {op.blurStrength ?? 20}
          </span>
        </div>
      )}

      {op.mode === "delogo" && <DelogoFields op={op} onPatch={onPatch} />}

      {op.mode === "image" && <ImageFields op={op} onPatch={onPatch} />}

      <div>
        <span className="cap-input-label">{t("logo.timeRange")}</span>
        <TimeRangeFields
          start={op.startTime}
          end={op.endTime}
          onStart={(value, options) => onPatch({ startTime: value }, options)}
          onEnd={(value, options) => onPatch({ endTime: value }, options)}
        />
      </div>

      <div className="flex gap-1.5">
        <Button
          type="button"
          onClick={() => get().removeOperationAt(videoIdx, opIdx)}
          variant="danger"
          size="sm"
          className="flex-1 !text-[10px]"
          style={{ color: "var(--text-rose)" }}
        >
          {t("logo.removeZone")}
        </Button>
        <Button
          type="button"
          onClick={() => get().selectOperation(null)}
          variant="secondary"
          size="sm"
          className="flex-1 !text-[10px]"
        >
          {t("logo.deselect")}
        </Button>
      </div>
    </div>
  );
}
