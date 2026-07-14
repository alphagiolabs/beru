import { Bold, Italic, Trash2, Plus, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { clampRegionToVideo } from "../../utils/video-utils";
import { FONT_FAMILIES, FONT_WEIGHTS, TEXT_ALIGNS } from "../../utils/types";
import { normalizeColor } from "../../utils/color-utils";
import TextLayoutControls from "../TextLayoutControls";
import {
  InspectorGroup,
  ToggleSwitch,
  SegmentedToolbar,
  FontFamilyPicker,
} from "../inspector";
import { useT } from "../../i18n/useT";

const COLOR_PRESETS = [
  "#ffffff",
  "#000000",
  "#fbbf24",
  "#f43f5e",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f97316",
];

const POS_PRESETS = [
  { id: "tl", label: "↖", x: 0.05, y: 0.05 },
  { id: "tc", label: "↑", x: 0.3, y: 0.05 },
  { id: "tr", label: "↗", x: 0.55, y: 0.05 },
  { id: "ml", label: "←", x: 0.05, y: 0.45 },
  { id: "cc", label: "⊕", x: 0.3, y: 0.45 },
  { id: "mr", label: "→", x: 0.55, y: 0.45 },
  { id: "bl", label: "↙", x: 0.05, y: 0.85 },
  { id: "bc", label: "↓", x: 0.3, y: 0.85 },
  { id: "br", label: "↘", x: 0.55, y: 0.85 },
];

function AlignIcon({ value }) {
  if (value === "center") return <AlignCenter size={12} />;
  if (value === "right") return <AlignRight size={12} />;
  return <AlignLeft size={12} />;
}

export default function TableEditorFocusPanel({
  hasRegions,
  focusedRegion,
  focusedVideo,
  focused,
  queueLength,
  focusedOp,
  updateFocused,
  createFocusedOp,
  deleteFocusedOp,
}) {
  const t = useT();
  const disabled = !focusedOp;

  return (
    <aside className="table-editor-focus">
      <div className="table-editor-focus-header">
        <div className="table-editor-section-label">{t("table.editRow")}</div>
        {focusedVideo && (
          <span className="table-editor-focus-index">
            V{focused.videoIdx + 1}/{queueLength}
            {focusedRegion ? ` · ${focusedRegion.label}` : ""}
          </span>
        )}
      </div>

      <div className="table-editor-focus-body">
        {!hasRegions ? (
          <div className="table-editor-empty">{t("table.noRegions")}</div>
        ) : !focusedRegion ? (
          <div className="table-editor-empty">{t("table.selectCell")}</div>
        ) : (
          <>
            <div
              className={`table-editor-status${focusedOp ? " table-editor-status--active" : ""}`}
            >
              <span className="table-editor-status-label">
                <span className="table-editor-status-dot" aria-hidden />
                {focusedOp ? t("table.opActive") : t("table.cellEmpty")}
              </span>
              {!focusedOp && (
                <button
                  type="button"
                  onClick={createFocusedOp}
                  className="cap-btn-primary !text-[10px] !py-0.5 !px-2"
                >
                  <Plus size={10} /> {t("table.create")}
                </button>
              )}
            </div>

            <InspectorGroup title={t("table.content")}>
              <label className="table-editor-field">
                <textarea
                  value={focusedOp?.text ?? ""}
                  onChange={(e) => updateFocused({ text: e.target.value })}
                  disabled={disabled}
                  placeholder={t("table.textPlaceholder")}
                  rows={2}
                  className="cap-input text-[11px] resize-y"
                  style={{ fontFamily: `"${focusedOp?.fontFamily || "Arial"}", sans-serif` }}
                />
              </label>
            </InspectorGroup>

            <InspectorGroup title={t("table.alignment")}>
              <SegmentedToolbar
                ariaLabel={t("table.alignment")}
                columns={3}
                value={focusedOp?.textAlign || "left"}
                disabled={disabled}
                onChange={(value) => updateFocused({ textAlign: value })}
                options={TEXT_ALIGNS.map((a) => ({
                  value: a.value,
                  title: a.value,
                  icon: <AlignIcon value={a.value} />,
                }))}
              />
              <div className="mt-2">
                <TextLayoutControls
                  values={{
                    autoFit: focusedOp?.autoFit,
                    lineHeight: focusedOp?.lineHeight,
                    verticalAlign: focusedOp?.verticalAlign,
                    textWrap: focusedOp?.textWrap,
                    safeMargin: focusedOp?.safeMargin,
                    truncate: focusedOp?.truncate,
                  }}
                  onPatch={updateFocused}
                  disabled={disabled}
                />
              </div>
            </InspectorGroup>

            <InspectorGroup title={t("table.typography")}>
              <FontFamilyPicker
                value={focusedOp?.fontFamily || "Arial"}
                options={FONT_FAMILIES}
                onChange={(fontFamily) => updateFocused({ fontFamily })}
                disabled={disabled}
                label={t("table.font")}
                ariaLabel={t("table.font")}
              />
              <div className="mt-2">
                <SegmentedToolbar
                  ariaLabel={t("table.weight")}
                  columns={4}
                  value={focusedOp?.fontWeight ?? 400}
                  disabled={disabled}
                  onChange={(value) => updateFocused({ fontWeight: value, bold: value >= 700 })}
                  options={FONT_WEIGHTS.map((w) => ({
                    value: w.value,
                    title: w.label,
                    label: "Aa",
                    style: { fontWeight: w.value },
                  }))}
                />
              </div>
              <div className="table-editor-slider-row mt-2">
                <span className="table-editor-slider-key">{t("table.size")}</span>
                <input
                  type="range"
                  min={8}
                  max={200}
                  value={focusedOp?.fontSize ?? 32}
                  onChange={(e) => updateFocused({ fontSize: Number(e.target.value) })}
                  disabled={disabled}
                />
                <input
                  type="number"
                  value={focusedOp?.fontSize ?? 32}
                  onChange={(e) => updateFocused({ fontSize: Number(e.target.value) })}
                  disabled={disabled}
                  min={8}
                  max={400}
                  className="cap-input table-editor-num"
                />
              </div>
              <div className="table-editor-slider-row">
                <span className="table-editor-slider-key">{t("table.tracking")}</span>
                <input
                  type="range"
                  min={-5}
                  max={30}
                  value={focusedOp?.letterSpacing ?? 0}
                  onChange={(e) => updateFocused({ letterSpacing: Number(e.target.value) })}
                  disabled={disabled}
                />
                <input
                  type="number"
                  value={focusedOp?.letterSpacing ?? 0}
                  onChange={(e) => updateFocused({ letterSpacing: Number(e.target.value) })}
                  disabled={disabled}
                  min={-20}
                  max={60}
                  step={0.5}
                  className="cap-input table-editor-num"
                />
              </div>
            </InspectorGroup>

            <InspectorGroup title={t("table.color")}>
              <div className="table-editor-color-row">
                <div className="table-editor-color-inputs">
                  <input
                    type="color"
                    value={normalizeColor(focusedOp?.fontColor) || "#ffffff"}
                    onChange={(e) => updateFocused({ fontColor: e.target.value })}
                    disabled={disabled}
                    className="table-editor-swatch"
                    aria-label={t("table.color")}
                  />
                  <input
                    type="text"
                    value={focusedOp?.fontColor || "#ffffff"}
                    onChange={(e) => updateFocused({ fontColor: e.target.value })}
                    disabled={disabled}
                    className="cap-input flex-1 font-mono text-[10px]"
                  />
                </div>
                <div className="table-editor-pct">
                  <input
                    type="number"
                    value={Math.round((focusedOp?.textOpacity ?? 1) * 100)}
                    onChange={(e) =>
                      updateFocused({
                        textOpacity: Math.max(0, Math.min(100, Number(e.target.value))) / 100,
                      })
                    }
                    disabled={disabled}
                    min={0}
                    max={100}
                    step={5}
                    className="cap-input table-editor-num"
                  />
                  %
                </div>
              </div>
              <div className="table-editor-slider-row mt-1.5">
                <span className="table-editor-slider-key">{t("table.opacity")}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={focusedOp?.textOpacity ?? 1}
                  onChange={(e) => updateFocused({ textOpacity: parseFloat(e.target.value) })}
                  disabled={disabled}
                />
              </div>
              <div className="table-editor-presets mt-1.5">
                {COLOR_PRESETS.map((c) => {
                  const active = (focusedOp?.fontColor || "").toLowerCase() === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => focusedOp && updateFocused({ fontColor: c })}
                      disabled={disabled}
                      className={`table-editor-preset${active ? " is-active" : ""}`}
                      style={{ background: c }}
                      title={c}
                      aria-label={c}
                    />
                  );
                })}
              </div>
            </InspectorGroup>

            <InspectorGroup
              title={t("table.background")}
              collapsible
              forceOpen={focusedOp?.bgEnabled !== false}
              collapseWhenOff
              hideChevron
              headerAccessory={
                <ToggleSwitch
                  checked={focusedOp?.bgEnabled !== false}
                  onChange={(on) => updateFocused({ bgEnabled: on })}
                  disabled={disabled}
                  ariaLabel={t("table.background")}
                />
              }
            >
              {focusedOp?.bgEnabled !== false && focusedOp && (
                <>
                  <div className="table-editor-color-row">
                    <div className="table-editor-color-inputs">
                      <input
                        type="color"
                        value={normalizeColor(focusedOp.bgColor) || "#000000"}
                        onChange={(e) => updateFocused({ bgColor: e.target.value })}
                        className="table-editor-swatch"
                        aria-label={t("table.background")}
                      />
                      <input
                        type="text"
                        value={focusedOp.bgColor || "#000000"}
                        onChange={(e) => updateFocused({ bgColor: e.target.value })}
                        className="cap-input flex-1 font-mono text-[10px]"
                      />
                    </div>
                    <div className="table-editor-pct">
                      <input
                        type="number"
                        value={Math.round((focusedOp.bgOpacity ?? 0.65) * 100)}
                        onChange={(e) =>
                          updateFocused({
                            bgOpacity: Math.max(0, Math.min(100, Number(e.target.value))) / 100,
                          })
                        }
                        min={0}
                        max={100}
                        step={5}
                        className="cap-input table-editor-num"
                      />
                      %
                    </div>
                  </div>
                  <div className="table-editor-slider-row mt-1.5">
                    <span className="table-editor-slider-key">{t("table.opacity")}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={focusedOp.bgOpacity ?? 0.65}
                      onChange={(e) => updateFocused({ bgOpacity: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="table-editor-slider-row">
                    <span className="table-editor-slider-key">{t("table.padding")}</span>
                    <input
                      type="range"
                      min={0}
                      max={40}
                      value={focusedOp.boxBorderWidth ?? 4}
                      onChange={(e) => updateFocused({ boxBorderWidth: Number(e.target.value) })}
                    />
                    <input
                      type="number"
                      value={focusedOp.boxBorderWidth ?? 4}
                      onChange={(e) => updateFocused({ boxBorderWidth: Number(e.target.value) })}
                      min={0}
                      max={80}
                      className="cap-input table-editor-num"
                    />
                  </div>
                </>
              )}
            </InspectorGroup>

            <InspectorGroup title={t("table.stroke")} collapsible defaultOpen={false}>
              <div className="flex items-center justify-end gap-1 mb-2">
                <button
                  type="button"
                  onClick={() => focusedOp && updateFocused({ bold: !focusedOp.bold })}
                  disabled={disabled}
                  className="cap-btn-secondary !px-1.5 !py-0.5"
                  style={
                    focusedOp?.bold
                      ? {
                          background: "var(--accent)",
                          color: "var(--bg-app)",
                          borderColor: "var(--accent)",
                        }
                      : undefined
                  }
                  title="Bold"
                  aria-pressed={!!focusedOp?.bold}
                >
                  <Bold size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => focusedOp && updateFocused({ italic: !focusedOp.italic })}
                  disabled={disabled}
                  className="cap-btn-secondary !px-1.5 !py-0.5"
                  style={
                    focusedOp?.italic
                      ? {
                          background: "var(--accent)",
                          color: "var(--bg-app)",
                          borderColor: "var(--accent)",
                        }
                      : undefined
                  }
                  title="Italic"
                  aria-pressed={!!focusedOp?.italic}
                >
                  <Italic size={10} />
                </button>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-1.5">
                <input
                  type="number"
                  value={focusedOp?.borderWidth ?? 0}
                  onChange={(e) => updateFocused({ borderWidth: Number(e.target.value) })}
                  disabled={disabled}
                  min={0}
                  max={20}
                  className="cap-input table-editor-num"
                  aria-label={t("table.strokeWidth")}
                />
                <div className="table-editor-color-inputs">
                  <input
                    type="color"
                    value={normalizeColor(focusedOp?.borderColor) || "#000000"}
                    onChange={(e) => updateFocused({ borderColor: e.target.value })}
                    disabled={disabled}
                    className="table-editor-swatch"
                    aria-label={t("table.strokeColor")}
                  />
                  <input
                    type="text"
                    value={focusedOp?.borderColor || "#000000"}
                    onChange={(e) => updateFocused({ borderColor: e.target.value })}
                    disabled={disabled}
                    className="cap-input flex-1 font-mono text-[10px]"
                  />
                </div>
              </div>
            </InspectorGroup>

            <InspectorGroup
              title={t("table.shadow")}
              collapsible
              forceOpen={!!focusedOp?.textShadowEnabled}
              collapseWhenOff
              hideChevron
              headerAccessory={
                <ToggleSwitch
                  checked={!!focusedOp?.textShadowEnabled}
                  onChange={(on) => updateFocused({ textShadowEnabled: on })}
                  disabled={disabled}
                  ariaLabel={t("table.shadow")}
                />
              }
            >
              {focusedOp?.textShadowEnabled && (
                <div className="flex flex-col gap-1.5">
                  <div className="table-editor-color-inputs">
                    <input
                      type="color"
                      value={normalizeColor(focusedOp.textShadowColor) || "#000000"}
                      onChange={(e) => updateFocused({ textShadowColor: e.target.value })}
                      disabled={disabled}
                      className="table-editor-swatch"
                    />
                    <input
                      type="text"
                      value={focusedOp.textShadowColor || "#000000"}
                      onChange={(e) => updateFocused({ textShadowColor: e.target.value })}
                      disabled={disabled}
                      className="cap-input flex-1 font-mono text-[10px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="table-editor-field">
                      <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                        Offset X
                      </span>
                      <input
                        type="number"
                        value={focusedOp.textShadowOffsetX ?? 2}
                        onChange={(e) =>
                          updateFocused({ textShadowOffsetX: Number(e.target.value) })
                        }
                        disabled={disabled}
                        min={-64}
                        max={64}
                        className="cap-input font-mono text-[10px] !py-0.5 text-center"
                      />
                    </label>
                    <label className="table-editor-field">
                      <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                        Offset Y
                      </span>
                      <input
                        type="number"
                        value={focusedOp.textShadowOffsetY ?? 2}
                        onChange={(e) =>
                          updateFocused({ textShadowOffsetY: Number(e.target.value) })
                        }
                        disabled={disabled}
                        min={-64}
                        max={64}
                        className="cap-input font-mono text-[10px] !py-0.5 text-center"
                      />
                    </label>
                  </div>
                </div>
              )}
            </InspectorGroup>

            {focusedOp?.region && (
              <InspectorGroup title={t("table.position")} collapsible defaultOpen={false}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)" }}>
                    {Math.round(focusedOp.region.x * (focusedVideo?.width || 1))},
                    {Math.round(focusedOp.region.y * (focusedVideo?.height || 1))}{" "}
                    {Math.round(focusedOp.region.w * (focusedVideo?.width || 1))}×
                    {Math.round(focusedOp.region.h * (focusedVideo?.height || 1))}
                    {focusedVideo?.width > 0 && (
                      <span style={{ color: "var(--text-muted, var(--text-dim))" }}>
                        {" "}
                        ({Math.round(focusedOp.region.x * 100)}%,{" "}
                        {Math.round(focusedOp.region.y * 100)}%)
                      </span>
                    )}
                  </span>
                </div>

                {focusedVideo?.width > 0 && focusedVideo?.height > 0 && (
                  <div
                    className="table-editor-mini-map"
                    style={{
                      aspectRatio: `${focusedVideo.width} / ${focusedVideo.height}`,
                    }}
                  >
                    <div
                      className="table-editor-mini-region"
                      style={{
                        left: `${focusedOp.region.x * 100}%`,
                        top: `${focusedOp.region.y * 100}%`,
                        width: `${focusedOp.region.w * 100}%`,
                        height: `${focusedOp.region.h * 100}%`,
                      }}
                    />
                  </div>
                )}

                <div className="table-editor-pos-grid">
                  {POS_PRESETS.map((p) => {
                    const w = focusedOp.region.w;
                    const h = focusedOp.region.h;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          updateFocused({
                            region: clampRegionToVideo({
                              x: p.x,
                              y: p.y,
                              w,
                              h,
                            }),
                          })
                        }
                        className="cap-btn-secondary !text-[10px] !px-0 !py-0.5"
                        title={p.id}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-1.5">
                  {[
                    ["X", "x"],
                    ["Y", "y"],
                    ["W", "w"],
                    ["H", "h"],
                  ].map(([label, key]) => {
                    const vw = focusedVideo?.width || 0;
                    const vh = focusedVideo?.height || 0;
                    const dimFor = (k) => (k === "x" || k === "w" ? vw : vh);
                    const pxVal = Math.round((focusedOp.region[key] || 0) * (dimFor(key) || 1));
                    return (
                      <div key={key} className="table-editor-nudge-row">
                        <span className="table-editor-nudge-key">{label}</span>
                        <input
                          type="number"
                          value={pxVal}
                          onChange={(e) => {
                            const px = Number(e.target.value);
                            if (!Number.isFinite(px) || !dimFor(key)) return;
                            updateFocused({
                              region: clampRegionToVideo({
                                ...focusedOp.region,
                                [key]: px / dimFor(key),
                              }),
                            });
                          }}
                          className="cap-input font-mono text-[10px] !py-0.5 flex-1 text-center"
                        />
                        <div className="table-editor-nudge-btns">
                          {[-10, -1, 1, 10].map((step) => (
                            <button
                              key={step}
                              type="button"
                              onClick={() => {
                                const d = dimFor(key) || 1;
                                updateFocused({
                                  region: clampRegionToVideo({
                                    ...focusedOp.region,
                                    [key]: focusedOp.region[key] + step / d,
                                  }),
                                });
                              }}
                              className="cap-btn-secondary"
                              title={`${step > 0 ? "+" : ""}${step}px`}
                            >
                              {step > 0 ? `+${step}` : step}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </InspectorGroup>
            )}

            <InspectorGroup title={t("table.time")} collapsible defaultOpen={false}>
              <div className="grid grid-cols-2 gap-2">
                <label className="table-editor-field">
                  <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                    {t("table.start")}
                  </span>
                  <input
                    type="number"
                    value={focusedOp?.startTime ?? ""}
                    onChange={(e) =>
                      updateFocused({
                        startTime: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    disabled={disabled}
                    placeholder="0"
                    className="cap-input font-mono text-[11px]"
                  />
                </label>
                <label className="table-editor-field">
                  <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                    {t("table.end")}
                  </span>
                  <input
                    type="number"
                    value={focusedOp?.endTime ?? ""}
                    onChange={(e) =>
                      updateFocused({
                        endTime: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    disabled={disabled}
                    placeholder={t("table.endPlaceholder")}
                    className="cap-input font-mono text-[11px]"
                  />
                </label>
              </div>
            </InspectorGroup>

            {focusedOp && (
              <button
                type="button"
                onClick={deleteFocusedOp}
                className="cap-btn-secondary table-editor-danger text-[11px]"
              >
                <Trash2 size={12} /> {t("table.deleteOp")}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
