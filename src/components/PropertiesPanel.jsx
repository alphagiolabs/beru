import { DelogoFields } from "./RegionEffectFields.jsx";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import StyleEditor from "./StyleEditor";
import PresetManager from "./PresetManager";
import BatchPanel from "./BatchPanel";
import AppliedTextEditor from "./AppliedTextEditor";
import AppliedDelogoEditor from "./AppliedDelogoEditor";
import DateTimeFields from "./DateTimeFields";
import AppliedDateTimeEditor from "./AppliedDateTimeEditor";
import RegionFields from "./RegionFields";
import VideoTransformControls from "./VideoTransformControls";
import VideoAudioControls from "./VideoAudioControls";
import ExternalAudioControls from "./ExternalAudioControls";
import VideoTimingControls from "./VideoTimingControls";
import TimeRangeFields from "./TimeRangeFields";
import CropRatioPresets from "./CropRatioPresets";
import { isRegionUsable } from "../utils/video-utils";
import { parseClockStart } from "../utils/datetime-stamp";
import { beruLocalUrl, imageVersion } from "../utils/beru-url";
import { storeErrorText } from "../utils/store-errors";
import { InspectorGroup } from "./inspector";
import { Eye, X, Film, SquareDashedMousePointer } from "lucide-react";
import { Button } from "./ui/Button";
import { PositionIcon } from "./ui/PositionIcon";

const selectSelectedVideo = (s) => {
  const item = s.selectedIdx >= 0 && s.selectedIdx < s.queue.length ? s.queue[s.selectedIdx] : null;
  if (!item) return null;
  return {
    path: item.path,
    src: item.src,
    filename: item.filename,
    width: item.width,
    height: item.height,
    duration: item.duration,
    operations: item.operations,
    customOutputName: item.customOutputName,
  };
};

const selectSelectedOperation = (s) =>
  s.selectedIdx >= 0 &&
  s.selectedIdx < s.queue.length &&
  s.selectedOperationIdx != null &&
  s.selectedOperationIdx >= 0 &&
  s.selectedOperationIdx < s.queue[s.selectedIdx].operations.length
    ? s.queue[s.selectedIdx].operations[s.selectedOperationIdx]
    : null;

const selectSelectedTemplateRegion = (s) =>
  s.selectedTemplateRegionId != null
    ? s.templateRegions.find((tr) => tr.id === s.selectedTemplateRegionId)
    : null;

export default function PropertiesPanel() {
  const sel = useEditorStore(selectSelectedVideo, shallow);
  const selectedOperation = useEditorStore(selectSelectedOperation);
  const selectedTemplateRegion = useEditorStore(selectSelectedTemplateRegion);
  const { selectedIdx, selectedOperationIdx, currentRegion, activeTool, sidebarMode } =
    useEditorStore(
      (s) => ({
        selectedIdx: s.selectedIdx,
        selectedOperationIdx: s.selectedOperationIdx,
        currentRegion: s.currentRegion,
        activeTool: s.activeTool,
        sidebarMode: s.sidebarMode,
      }),
      shallow,
    );
  const { tempImagePath, tempImageV, tempImageOpacity } = useEditorStore(
    (s) => ({
      tempImagePath: s.tempImagePath,
      tempImageV: s.tempImageV,
      tempImageOpacity: s.tempImageOpacity,
    }),
    shallow,
  );
  const {
    blurStrength,
    delogoMethod,
    delogoImagePath,
    delogoFillColor,
    delogoFillOpacity,
    temporalRadius,
    mosaicSize,
    mirrorSide,
    edgeFeather,
  } = useEditorStore(
    (s) => ({
      blurStrength: s.blurStrength,
      delogoMethod: s.delogoMethod,
      delogoImagePath: s.delogoImagePath,
      delogoFillColor: s.delogoFillColor,
      delogoFillOpacity: s.delogoFillOpacity,
      temporalRadius: s.temporalRadius,
      mosaicSize: s.mosaicSize,
      mirrorSide: s.mirrorSide,
      edgeFeather: s.edgeFeather,
    }),
    shallow,
  );
  const { textInput, tempClock, tempStart, tempEnd } = useEditorStore(
    (s) => ({
      textInput: s.textInput,
      tempClock: s.tempClock,
      tempStart: s.tempStart,
      tempEnd: s.tempEnd,
    }),
    shallow,
  );
  const showToast = useEditorStore((s) => s.showToast);
  const get = useEditorStore.getState;
  const t = useT();
  const imageScale = currentRegion?.baseW ? currentRegion.w / currentRegion.baseW : 1;
  const chooseLogoTool = (tool) => {
    const region = get().currentRegion;
    get().setActiveTool(tool);
    if (region) get().setCurrentRegion(region);
  };

  return (
    <div className="inspector-panel">
      <div className="inspector-sticky-chrome">
        {sidebarMode === "batch" && (
          <div className="inspector-chrome-title" data-testid="inspector-mode-title">
            {t("props.modeBatch")}
          </div>
        )}
        {sel?.filename && (
          <div className="inspector-chrome-meta">
            <span className="inspector-chrome-meta-key">{t("props.video")}</span>
            <span className="inspector-chrome-meta-value" title={sel.filename}>
              {sel.filename}
            </span>
          </div>
        )}
      </div>

      <div className="inspector-body">
        {!currentRegion && sidebarMode === "logo" && selectedOperation?.mode === "datetime" && (
          <AppliedDateTimeEditor
            op={selectedOperation}
            video={sel}
            onPatch={(patch) => get().updateOperation(selectedIdx, selectedOperationIdx, patch)}
            onRemove={() => get().removeOperation(selectedOperationIdx)}
            onDone={() => get().selectOperation(null)}
          />
        )}
        {sel && <VideoTransformControls />}
        {sel && <VideoAudioControls />}
        {sel && <VideoTimingControls key={`timing:${selectedIdx}:${sel.path}`} />}
        {sel && <ExternalAudioControls key={`${selectedIdx}:${sel.path}`} />}
        {!currentRegion &&
          sidebarMode === "logo" &&
          !selectedOperation &&
          (sel?.operations?.length ? (
            <p className="inspector-helper text-center">{t("props.empty.pickLayer")}</p>
          ) : (
            <div className="inspector-empty">
              <span className="inspector-empty-icon" aria-hidden>
                {sel ? <SquareDashedMousePointer size={16} /> : <Film size={16} />}
              </span>
              <p className="inspector-empty-title">
                {t(sel ? "props.empty.drawTitle" : "props.empty.noVideoTitle")}
              </p>
              <p className="inspector-empty-hint">
                {t(
                  !sel
                    ? "props.empty.noVideoHint"
                    : activeTool === "datetime"
                      ? "datetime.drawHint"
                      : "props.empty.drawHint",
                )}
              </p>
            </div>
          ))}

        {!currentRegion &&
          sidebarMode === "logo" &&
          activeTool === "datetime" &&
          sel &&
          !selectedOperation && (
            <Button
              type="button"
              variant="primary"
              className="w-full"
              onClick={() => get().applyDvrStampStyle()}
              title={t("datetime.dvrStyleHint")}
            >
              {t("datetime.dvrStyle")}
            </Button>
          )}

        {currentRegion && (
          <>
            <section className="inspector-region-strip" aria-label={t("props.regionLabel")}>
              <div className="inspector-region-strip-head">
                <span className="inspector-region-strip-title">{t("props.regionLabel")}</span>
              </div>
              <div className="inspector-region-strip-fields" role="group">
                <RegionFields
                  region={currentRegion}
                  dims={{ w: sel?.width || 0, h: sel?.height || 0 }}
                  variant="strip"
                  onRegionChange={(next) => get().setCurrentRegion(next)}
                />
              </div>
            </section>

            {sidebarMode === "logo" && ["blur", "delogo", "crop"].includes(activeTool) && (
              <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("logo.method")}>
                {[
                  ["blur", t("toolbar.blur")],
                  ["crop", t("toolbar.crop")],
                  ["delogo", t("logo.advancedMethods")],
                ].map(([tool, label]) => (
                  <button
                    key={tool}
                    type="button"
                    className={`inspector-chip${activeTool === tool ? " is-selected" : ""}`}
                    aria-pressed={activeTool === tool}
                    onClick={() => chooseLogoTool(tool)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {sidebarMode === "logo" && activeTool === "crop" && (
              <CropRatioPresets
                region={currentRegion}
                dims={{ w: sel?.width || 0, h: sel?.height || 0 }}
                timed={tempStart != null || tempEnd != null}
                operations={[
                  ...(sel?.operations ?? []),
                  { mode: "crop", region: currentRegion, startTime: tempStart, endTime: tempEnd },
                ]}
                onRegionChange={(next) => get().setCurrentRegion(next)}
              />
            )}

            {sidebarMode === "batch" && (
              <div className="inspector-actions inspector-actions--region">
                <Button
                  type="button"
                  onClick={() => get().addTemplateRegion()}
                  disabled={!isRegionUsable(currentRegion)}
                  variant="primary"
                  className="flex-1 min-w-0"
                >
                  {t("props.addRegion")}
                </Button>
                <Button
                  type="button"
                  onClick={() => get().cancelBatchRegionSelection()}
                  variant="tertiary"
                  title={t("logo.cancelSelection")}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            )}

            {sidebarMode === "logo" && activeTool === "image" && (
              <InspectorGroup title={t("props.watermark")}>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={tempImagePath ? tempImagePath.split(/[\\/]/).pop() : ""}
                    placeholder={t("logo.pickLogo")}
                    readOnly
                    className="cap-input flex-1 font-mono text-[10px] truncate"
                  />
                  <Button
                    onClick={async () => {
                      const res = await window.api?.pickImage();
                      if (res?.success) {
                        const r = await window.api?.statImage(res.path);
                        if (r?.success) get().setTempImagePath(res.path, imageVersion(r));
                        else {
                          get().setTempImagePath(res.path);
                          showToast({
                            kind: "err",
                            text: storeErrorText(t, r, "errors.imageReadFailed"),
                          });
                        }
                      }
                    }}
                    variant="secondary"
                    size="sm"
                    className="!text-[10px] !px-2"
                  >
                    {t("logo.pick")}
                  </Button>
                  {tempImagePath && (
                    <Button
                      onClick={() => {
                        get().setTempImagePath("");
                      }}
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
                {tempImagePath && (
                  <div
                    className="rounded overflow-hidden border"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <img
                      src={beruLocalUrl(tempImagePath, tempImageV)}
                      alt="preview"
                      className="block w-full max-h-32 object-contain"
                      style={{ background: "var(--bg-app)" }}
                    />
                  </div>
                )}
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
                    value={tempImageOpacity}
                    onChange={(e) => get().setTempImageOpacity(Number(e.target.value))}
                    className="inspector-range"
                  />
                  <span
                    className="font-mono text-xs w-8 text-right"
                    style={{ color: "var(--text-brand)" }}
                  >
                    {Math.round(tempImageOpacity * 100)}%
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 text-[11px] min-w-0"
                  style={{ color: "var(--text-dim)" }}
                >
                  {t("props.scale")}
                  <input
                    type="range"
                    min="0.1"
                    max="3"
                    step="0.1"
                    value={imageScale}
                    onChange={(e) => {
                      const scale = Number(e.target.value);
                      if (currentRegion) {
                        const baseW = currentRegion.baseW || currentRegion.w;
                        const baseH = currentRegion.baseH || currentRegion.h;
                        get().setCurrentRegion({
                          ...currentRegion,
                          baseW,
                          baseH,
                          w: baseW * scale,
                          h: baseH * scale,
                        });
                      }
                    }}
                    className="inspector-range"
                  />
                  <span
                    className="font-mono text-xs w-8 text-right"
                    style={{ color: "var(--text-brand)" }}
                  >
                    {imageScale.toFixed(1)}x
                  </span>
                </div>
                <div>
                  <span className="cap-input-label">{t("props.quickPosition")}</span>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { id: "top-left", x: 0.02, y: 0.02 },
                      { id: "top-center", x: 0.5, y: 0.02 },
                      { id: "top-right", x: 0.98, y: 0.02 },
                      { id: "center-left", x: 0.02, y: 0.5 },
                      { id: "center", x: 0.5, y: 0.5 },
                      { id: "center-right", x: 0.98, y: 0.5 },
                      { id: "bottom-left", x: 0.02, y: 0.98 },
                      { id: "bottom-center", x: 0.5, y: 0.98 },
                      { id: "bottom-right", x: 0.98, y: 0.98 },
                    ].map((pos) => (
                      <button
                        key={pos.id}
                        onClick={() => {
                          const w = currentRegion?.w || 0.15;
                          const h = currentRegion?.h || 0.15;
                          let x = pos.x;
                          let y = pos.y;
                          if (pos.x === 0.98) x = pos.x - w;
                          else if (pos.x === 0.5) x = pos.x - w / 2;
                          if (pos.y === 0.98) y = pos.y - h;
                          else if (pos.y === 0.5) y = pos.y - h / 2;
                          get().setCurrentRegion({ x, y, w, h, baseW: w, baseH: h });
                        }}
                        className="inspector-chip"
                        title={t(`position.${pos.id}`)}
                        aria-label={t(`position.${pos.id}`)}
                      >
                        <PositionIcon position={pos.id} size={14} strokeWidth={2} />
                      </button>
                    ))}
                  </div>
                </div>
              </InspectorGroup>
            )}

            {sidebarMode === "logo" && activeTool === "blur" && (
              <InspectorGroup title={t("props.blurGroup")}>
                <div
                  className="flex items-center gap-2 text-[11px] min-w-0"
                  style={{ color: "var(--text-dim)" }}
                >
                  {t("props.intensity")}
                  <input
                    type="range"
                    min="2"
                    max="60"
                    value={blurStrength}
                    onChange={(e) => get().setBlurStrength(Number(e.target.value))}
                    className="inspector-range"
                  />
                  <span
                    className="font-mono text-xs w-6 text-right"
                    style={{ color: "var(--text-brand)" }}
                  >
                    {blurStrength}
                  </span>
                </div>
              </InspectorGroup>
            )}

            {sidebarMode === "logo" && activeTool === "delogo" && (
              <InspectorGroup title={t("props.delogoGroup")}>
                <div className="flex items-center justify-between">
                  <span className="cap-input-label !mb-0">{t("props.method")}</span>
                  <span
                    className="flex items-center gap-1 text-[10px] font-medium"
                    style={{ color: "var(--text-rose)" }}
                    title={t("logo.quickPreviewHint")}
                  >
                    <Eye size={10} /> {t("logo.quickPreview")}
                  </span>
                </div>
                <DelogoFields
                  variant="draft"
                  op={{
                    delogoMethod,
                    blurStrength,
                    delogoFillColor,
                    delogoFillOpacity,
                    delogoImagePath,
                    temporalRadius,
                    mosaicSize,
                    mirrorSide,
                    edgeFeather,
                  }}
                  onPatch={(patch) => {
                    const state = get();
                    if (Object.hasOwn(patch, "delogoImagePath"))
                      state.setDelogoImagePath(patch.delogoImagePath, patch.delogoImageV);
                    for (const [key, value] of Object.entries(patch)) {
                      if (key === "delogoImagePath" || key === "delogoImageV") continue;
                      state[`set${key[0].toUpperCase()}${key.slice(1)}`](value);
                    }
                  }}
                />
              </InspectorGroup>
            )}

            {(activeTool === "text" || activeTool === "datetime" || sidebarMode === "batch") && (
              <div className="space-y-2.5">
                {sidebarMode === "logo" && activeTool === "datetime" && (
                  <DateTimeFields
                    value={tempClock}
                    onPatch={(patch) => get().setTempClock(patch)}
                    onApplyDvrStyle={() => get().applyDvrStampStyle()}
                  />
                )}
                {sidebarMode === "logo" && activeTool === "text" && (
                  <InspectorGroup title={t("props.content")}>
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => get().setTextInput(e.target.value)}
                      placeholder={t("props.textPlaceholder")}
                      className="cap-input"
                    />
                  </InspectorGroup>
                )}
                <StyleEditor />
                <InspectorGroup
                  title={t("logo.autoPosition")}
                  className="inspector-group--auto-pos"
                >
                  <div
                    className="inspector-auto-pos"
                    role="group"
                    aria-label={t("logo.autoPosition")}
                  >
                    {[
                      ["top-left", { x: 0.05, y: 0.05, w: 0.4, h: 0.08 }],
                      ["center", { x: 0.3, y: 0.46, w: 0.4, h: 0.08 }],
                      ["top-right", { x: 0.55, y: 0.05, w: 0.4, h: 0.08 }],
                      ["bottom-left", { x: 0.05, y: 0.87, w: 0.4, h: 0.08 }],
                      ["bottom-right", { x: 0.55, y: 0.87, w: 0.4, h: 0.08 }],
                    ].map(([pos, region]) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => get().setCurrentRegion(region)}
                        className="inspector-auto-pos-btn"
                        title={t(`position.${pos}`)}
                        aria-label={t(`position.${pos}`)}
                      >
                        <PositionIcon position={pos} size={14} strokeWidth={2} />
                      </button>
                    ))}
                  </div>
                </InspectorGroup>
                <PresetManager />
              </div>
            )}

            {sidebarMode === "logo" && (
              <InspectorGroup title={t("logo.timeRange")}>
                <TimeRangeFields
                  start={tempStart}
                  end={tempEnd}
                  onStart={(value) => get().setTempStart(value)}
                  onEnd={(value) => get().setTempEnd(value)}
                />
              </InspectorGroup>
            )}

            {sidebarMode === "logo" && (
              <div className="inspector-actions">
                <Button
                  type="button"
                  onClick={() => get().addOperation(activeTool)}
                  disabled={
                    activeTool === "datetime" && parseClockStart(tempClock.clockStart) == null
                  }
                  variant="primary"
                  className="w-full"
                >
                  {t("props.apply", { op: t(`catalog.applyOp.${activeTool}`) })}
                </Button>
                <button
                  type="button"
                  onClick={() => get().setCurrentRegion(null)}
                  className="text-[11px] hover:underline block mx-auto"
                  style={{ color: "var(--text-dim)" }}
                >
                  {t("logo.cancelSelection")}
                </button>
              </div>
            )}
          </>
        )}

        {!currentRegion && sidebarMode === "logo" && selectedOperation?.mode === "text" && (
          <AppliedTextEditor
            op={selectedOperation}
            video={sel}
            onPatch={(patch) => get().updateOperation(selectedIdx, selectedOperationIdx, patch)}
          />
        )}

        {!currentRegion &&
          sidebarMode === "logo" &&
          (selectedOperation?.mode === "blur" ||
            selectedOperation?.mode === "delogo" ||
            selectedOperation?.mode === "crop" ||
            selectedOperation?.mode === "image") && (
            <AppliedDelogoEditor
              key={selectedOperation.id ?? selectedOperationIdx}
              op={selectedOperation}
              videoIdx={selectedIdx}
              opIdx={selectedOperationIdx}
              video={sel}
            />
          )}

        {!currentRegion && sidebarMode === "batch" && selectedTemplateRegion && (
          <AppliedTextEditor
            op={{
              mode: "text",
              text: selectedTemplateRegion.label,
              region: selectedTemplateRegion.region,
              ...(selectedTemplateRegion.style || {}),
            }}
            video={sel}
            title={t("props.appliedRegion")}
            showContent={false}
            onPatch={(patch) => get().updateTemplateRegion(selectedTemplateRegion.id, patch)}
          />
        )}

        {sidebarMode === "batch" && <BatchPanel />}
      </div>
    </div>
  );
}
