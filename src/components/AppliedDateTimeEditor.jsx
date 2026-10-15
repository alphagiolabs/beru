import { useEffect, useRef } from "react";
import { useT } from "../i18n/useT";
import { DVR_STAMP_REGION, dvrStampStyle } from "../utils/datetime-stamp";
import { pickTextStyle, scaleTextStyleToRegion } from "../utils/text-style";
import { clampRegionToVideo } from "../utils/video-utils";
import { itemOutputGeometry } from "../utils/stamp-geometry";
import DateTimeFields from "./DateTimeFields";
import StyleEditor from "./StyleEditor";
import { Button } from "./ui/Button";

export default function AppliedDateTimeEditor({ op, video, onPatch, onRemove, onDone }) {
  const t = useT();
  const rootRef = useRef(null);
  const resizeBase = useRef(null);

  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [op.id]);

  const output = (video && itemOutputGeometry(video)?.output) || { width: 1920, height: 1080 };
  const vw = output.width;
  const vh = output.height;
  const region = op.region || { x: 0, y: 0, w: 0.3, h: 0.1 };
  const dimFor = (key) => (key === "x" || key === "w" ? vw : vh);
  const patchRegionKey = (key, px) => {
    const dim = dimFor(key);
    if (!Number.isFinite(px) || !dim) return;
    const next = clampRegionToVideo({ ...region, [key]: px / dim });
    const base = resizeBase.current;
    onPatch({ region: next, ...(base ? scaleTextStyleToRegion(base, base.region, next) : {}) });
  };

  return (
    <div
      ref={rootRef}
      className="mb-3 space-y-2.5 border-t pt-3"
      style={{ borderColor: "var(--border)", scrollMarginTop: 8 }}
      data-testid="applied-datetime-editor"
    >
      <div className="cap-section-title">{t("datetime.applied")}</div>

      <DateTimeFields value={op} onPatch={onPatch} />

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full"
        title={t("datetime.dvrStyleHint")}
        onClick={() =>
          onPatch({
            ...dvrStampStyle(vh),
            region: { ...DVR_STAMP_REGION },
            clockLayout: "single",
          })
        }
      >
        {t("datetime.dvrStyle")}
      </Button>

      <StyleEditor value={pickTextStyle(op)} onPatch={onPatch} showFlowControls={false} />

      <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="cap-input-label !mb-0">{t("props.textBox")}</span>
          <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)" }}>
            {Math.round(region.w * vw)}×{Math.round(region.h * vh)} px
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {["x", "y", "w", "h"].map((key) => (
            <label key={key}>
              <span className="cap-input-label">{key.toUpperCase()}</span>
              <input
                type="number"
                value={Math.round((region[key] || 0) * dimFor(key))}
                onChange={(e) => patchRegionKey(key, Number(e.target.value))}
                onFocus={() => {
                  if (key === "w" || key === "h") resizeBase.current = { ...op, region };
                }}
                onBlur={() => {
                  resizeBase.current = null;
                }}
                className="cap-input font-mono text-[11px]"
                min={0}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5">
        <Button type="button" onClick={onRemove} variant="danger" size="sm" className="flex-1">
          {t("props.actions.deleteLayer")}
        </Button>
        <Button type="button" onClick={onDone} variant="secondary" size="sm" className="flex-1">
          {t("logo.deselect")}
        </Button>
      </div>
    </div>
  );
}
