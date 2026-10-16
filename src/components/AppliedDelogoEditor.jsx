import { DelogoFields } from "./RegionEffectFields.jsx";
import { Upload } from "lucide-react";
import { imageVersion } from "../utils/beru-url";
import { storeErrorText } from "../utils/store-errors";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import RegionFields from "./RegionFields";
import TimeRangeFields from "./TimeRangeFields";
import CropRatioPresets from "./CropRatioPresets";
import HistoryRange from "./HistoryRange.jsx";

const TITLE_KEYS = {
  blur: "props.appliedBlur",
  delogo: "props.appliedDelogo",
  crop: "props.appliedCrop",
};

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
        <HistoryRange
          owner={op.id}
          min="0"
          max="1"
          step="0.05"
          value={op.imageOpacity ?? 1}
          onValueChange={(value, options) => onPatch({ imageOpacity: value }, options)}
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
          <HistoryRange
            owner={op.id}
            min="2"
            max="60"
            value={op.blurStrength ?? 20}
            onValueChange={(value, options) => onPatch({ blurStrength: value }, options)}
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
