import { useState } from "react";
import {
  Bold,
  Italic,
  Trash2,
  Plus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronDown,
} from "lucide-react";
import { clampRegionToVideo } from "../../utils/video-utils";
import { FONT_FAMILIES, FONT_WEIGHTS, TEXT_ALIGNS } from "../../utils/types";
import { normalizeColor } from "../../utils/color-utils";
import TextLayoutControls from "../TextLayoutControls";
import { ToggleSwitch } from "../inspector";
import { useT } from "../../i18n/useT";
import useOverlayScroll from "./useOverlayScroll";

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
  if (value === "center") return <AlignCenter size={13} strokeWidth={2} />;
  if (value === "right") return <AlignRight size={13} strokeWidth={2} />;
  return <AlignLeft size={13} strokeWidth={2} />;
}

function ToolBtn({ active, disabled, onClick, title, children }) {
  return (
    <button
      type="button"
      className={`te-tool${active ? " is-on" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-pressed={!!active}
    >
      {children}
    </button>
  );
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
  const bindScroll = useOverlayScroll();
  const [moreOpen, setMoreOpen] = useState(false);

  const breadcrumb = focusedVideo
    ? `V${focused.videoIdx + 1}/${queueLength}${focusedRegion ? ` · ${focusedRegion.label}` : ""}`
    : "";

  return (
    <aside className="te-side">
      <div className="te-side-head">
        <span className="te-side-title">{t("table.editRow")}</span>
        {breadcrumb ? <span className="te-side-meta">{breadcrumb}</span> : null}
      </div>

      <div ref={bindScroll} className="te-side-body table-editor-scroll">
        {!hasRegions ? (
          <div className="te-blank">
            <p>{t("table.noRegions")}</p>
          </div>
        ) : !focusedRegion ? (
          <div className="te-blank">
            <p>{t("table.selectCell")}</p>
          </div>
        ) : !focusedOp ? (
          <div className="te-blank te-blank--action">
            <p className="te-blank-kicker">{t("table.cellEmpty")}</p>
            <p className="te-blank-copy">{t("table.emptyHint")}</p>
            <button type="button" className="te-primary" onClick={createFocusedOp}>
              <Plus size={14} strokeWidth={2.25} />
              {t("table.create")}
            </button>
          </div>
        ) : (
          <div className="te-form">
            <textarea
              value={focusedOp.text ?? ""}
              onChange={(e) => updateFocused({ text: e.target.value })}
              placeholder={t("table.textPlaceholder")}
              rows={3}
              className="te-textarea"
              style={{ fontFamily: `"${focusedOp.fontFamily || "Arial"}", sans-serif` }}
            />

            <div className="te-toolbar" role="toolbar" aria-label={t("table.typography")}>
              <div className="te-seg" role="radiogroup" aria-label={t("table.alignment")}>
                {TEXT_ALIGNS.map((a) => (
                  <ToolBtn
                    key={a.value}
                    active={(focusedOp.textAlign || "left") === a.value}
                    onClick={() => updateFocused({ textAlign: a.value })}
                    title={a.value}
                  >
                    <AlignIcon value={a.value} />
                  </ToolBtn>
                ))}
              </div>
              <div className="te-seg">
                <ToolBtn
                  active={!!focusedOp.bold}
                  onClick={() => updateFocused({ bold: !focusedOp.bold })}
                  title="Bold"
                >
                  <Bold size={13} strokeWidth={2.25} />
                </ToolBtn>
                <ToolBtn
                  active={!!focusedOp.italic}
                  onClick={() => updateFocused({ italic: !focusedOp.italic })}
                  title="Italic"
                >
                  <Italic size={13} strokeWidth={2.25} />
                </ToolBtn>
              </div>
            </div>

            <div className="te-row">
              <label className="te-field te-field--grow">
                <span className="te-label">{t("table.font")}</span>
                <select
                  className="te-select"
                  value={focusedOp.fontFamily || "Arial"}
                  onChange={(e) => updateFocused({ fontFamily: e.target.value })}
                >
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="te-field te-field--weight">
                <span className="te-label">{t("table.weight")}</span>
                <select
                  className="te-select"
                  value={focusedOp.fontWeight ?? 400}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    updateFocused({ fontWeight: value, bold: value >= 700 });
                  }}
                >
                  {FONT_WEIGHTS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="te-slider">
              <span className="te-label">{t("table.size")}</span>
              <input
                type="range"
                min={8}
                max={200}
                value={focusedOp.fontSize ?? 32}
                onChange={(e) => updateFocused({ fontSize: Number(e.target.value) })}
              />
              <input
                type="number"
                className="te-num"
                min={8}
                max={400}
                value={focusedOp.fontSize ?? 32}
                onChange={(e) => updateFocused({ fontSize: Number(e.target.value) })}
              />
            </div>

            <div className="te-slider">
              <span className="te-label">{t("table.tracking")}</span>
              <input
                type="range"
                min={-5}
                max={30}
                value={focusedOp.letterSpacing ?? 0}
                onChange={(e) => updateFocused({ letterSpacing: Number(e.target.value) })}
              />
              <input
                type="number"
                className="te-num"
                min={-20}
                max={80}
                step={0.5}
                value={focusedOp.letterSpacing ?? 0}
                onChange={(e) => updateFocused({ letterSpacing: Number(e.target.value) })}
              />
            </div>

            <div className="te-color-block">
              <div className="te-color-main">
                <input
                  type="color"
                  className="te-swatch"
                  value={normalizeColor(focusedOp.fontColor) || "#ffffff"}
                  onChange={(e) => updateFocused({ fontColor: e.target.value })}
                  aria-label={t("table.color")}
                />
                <input
                  type="text"
                  className="te-hex"
                  value={focusedOp.fontColor || "#ffffff"}
                  onChange={(e) => updateFocused({ fontColor: e.target.value })}
                />
                <div className="te-opacity">
                  <input
                    type="number"
                    className="te-num"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round((focusedOp.textOpacity ?? 1) * 100)}
                    onChange={(e) =>
                      updateFocused({
                        textOpacity: Math.max(0, Math.min(100, Number(e.target.value))) / 100,
                      })
                    }
                  />
                  <span>%</span>
                </div>
              </div>
              <div className="te-presets">
                {COLOR_PRESETS.map((c) => {
                  const active = (focusedOp.fontColor || "").toLowerCase() === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`te-preset${active ? " is-on" : ""}`}
                      style={{ background: c }}
                      title={c}
                      aria-label={c}
                      onClick={() => updateFocused({ fontColor: c })}
                    />
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className={`te-more-toggle${moreOpen ? " is-open" : ""}`}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <span>{t("table.moreOptions")}</span>
              <ChevronDown size={14} strokeWidth={2} />
            </button>

            {moreOpen ? (
              <div className="te-more">
                <div className="te-more-section">
                  <span className="te-label">{t("table.layout")}</span>
                  <TextLayoutControls
                    values={{
                      autoFit: focusedOp.autoFit,
                      lineHeight: focusedOp.lineHeight,
                      verticalAlign: focusedOp.verticalAlign,
                      textWrap: focusedOp.textWrap,
                      safeMargin: focusedOp.safeMargin,
                      truncate: focusedOp.truncate,
                    }}
                    onPatch={updateFocused}
                  />
                </div>

                <div className="te-more-section">
                  <div className="te-switch-row">
                    <span className="te-label !mb-0">{t("table.background")}</span>
                    <ToggleSwitch
                      checked={focusedOp.bgEnabled !== false}
                      onChange={(on) => updateFocused({ bgEnabled: on })}
                      ariaLabel={t("table.background")}
                    />
                  </div>
                  {focusedOp.bgEnabled !== false && (
                    <div className="te-more-stack">
                      <div className="te-color-main">
                        <input
                          type="color"
                          className="te-swatch"
                          value={normalizeColor(focusedOp.bgColor) || "#000000"}
                          onChange={(e) => updateFocused({ bgColor: e.target.value })}
                        />
                        <input
                          type="text"
                          className="te-hex"
                          value={focusedOp.bgColor || "#000000"}
                          onChange={(e) => updateFocused({ bgColor: e.target.value })}
                        />
                      </div>
                      <div className="te-slider">
                        <span className="te-label">{t("table.opacity")}</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={focusedOp.bgOpacity ?? 0.65}
                          onChange={(e) => updateFocused({ bgOpacity: parseFloat(e.target.value) })}
                        />
                      </div>
                      <div className="te-slider">
                        <span className="te-label">{t("table.padding")}</span>
                        <input
                          type="range"
                          min={0}
                          max={40}
                          value={focusedOp.boxBorderWidth ?? 4}
                          onChange={(e) =>
                            updateFocused({ boxBorderWidth: Number(e.target.value) })
                          }
                        />
                        <input
                          type="number"
                          className="te-num"
                          min={0}
                          max={80}
                          value={focusedOp.boxBorderWidth ?? 4}
                          onChange={(e) =>
                            updateFocused({ boxBorderWidth: Number(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="te-more-section">
                  <span className="te-label">{t("table.stroke")}</span>
                  <div className="te-color-main">
                    <input
                      type="number"
                      className="te-num"
                      min={0}
                      max={20}
                      value={focusedOp.borderWidth ?? 0}
                      onChange={(e) => updateFocused({ borderWidth: Number(e.target.value) })}
                      aria-label={t("table.strokeWidth")}
                    />
                    <input
                      type="color"
                      className="te-swatch"
                      value={normalizeColor(focusedOp.borderColor) || "#000000"}
                      onChange={(e) => updateFocused({ borderColor: e.target.value })}
                      aria-label={t("table.strokeColor")}
                    />
                    <input
                      type="text"
                      className="te-hex"
                      value={focusedOp.borderColor || "#000000"}
                      onChange={(e) => updateFocused({ borderColor: e.target.value })}
                    />
                  </div>
                </div>

                <div className="te-more-section">
                  <div className="te-switch-row">
                    <span className="te-label !mb-0">{t("table.shadow")}</span>
                    <ToggleSwitch
                      checked={!!focusedOp.textShadowEnabled}
                      onChange={(on) => updateFocused({ textShadowEnabled: on })}
                      ariaLabel={t("table.shadow")}
                    />
                  </div>
                  {focusedOp.textShadowEnabled && (
                    <div className="te-more-stack">
                      <div className="te-color-main">
                        <input
                          type="color"
                          className="te-swatch"
                          value={normalizeColor(focusedOp.textShadowColor) || "#000000"}
                          onChange={(e) => updateFocused({ textShadowColor: e.target.value })}
                        />
                        <input
                          type="text"
                          className="te-hex"
                          value={focusedOp.textShadowColor || "#000000"}
                          onChange={(e) => updateFocused({ textShadowColor: e.target.value })}
                        />
                      </div>
                      <div className="te-row">
                        <label className="te-field te-field--grow">
                          <span className="te-label">X</span>
                          <input
                            type="number"
                            className="te-select"
                            min={-64}
                            max={64}
                            value={focusedOp.textShadowOffsetX ?? 2}
                            onChange={(e) =>
                              updateFocused({ textShadowOffsetX: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label className="te-field te-field--grow">
                          <span className="te-label">Y</span>
                          <input
                            type="number"
                            className="te-select"
                            min={-64}
                            max={64}
                            value={focusedOp.textShadowOffsetY ?? 2}
                            onChange={(e) =>
                              updateFocused({ textShadowOffsetY: Number(e.target.value) })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {focusedOp.region && (
                  <div className="te-more-section">
                    <span className="te-label">{t("table.position")}</span>
                    {focusedVideo?.width > 0 && focusedVideo?.height > 0 && (
                      <div
                        className="te-minimap"
                        style={{
                          aspectRatio: `${focusedVideo.width} / ${focusedVideo.height}`,
                        }}
                      >
                        <div
                          className="te-minimap-region"
                          style={{
                            left: `${focusedOp.region.x * 100}%`,
                            top: `${focusedOp.region.y * 100}%`,
                            width: `${focusedOp.region.w * 100}%`,
                            height: `${focusedOp.region.h * 100}%`,
                          }}
                        />
                      </div>
                    )}
                    <div className="te-pos-grid">
                      {POS_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="te-pos-btn"
                          title={p.id}
                          onClick={() =>
                            updateFocused({
                              region: clampRegionToVideo({
                                x: p.x,
                                y: p.y,
                                w: focusedOp.region.w,
                                h: focusedOp.region.h,
                              }),
                            })
                          }
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="te-more-stack">
                      {[
                        ["X", "x"],
                        ["Y", "y"],
                        ["W", "w"],
                        ["H", "h"],
                      ].map(([label, key]) => {
                        const vw = focusedVideo?.width || 0;
                        const vh = focusedVideo?.height || 0;
                        const dim = key === "x" || key === "w" ? vw : vh;
                        const pxVal = Math.round((focusedOp.region[key] || 0) * (dim || 1));
                        return (
                          <div key={key} className="te-nudge">
                            <span className="te-nudge-key">{label}</span>
                            <input
                              type="number"
                              className="te-num te-num--wide"
                              value={pxVal}
                              onChange={(e) => {
                                const px = Number(e.target.value);
                                if (!Number.isFinite(px) || !dim) return;
                                updateFocused({
                                  region: clampRegionToVideo({
                                    ...focusedOp.region,
                                    [key]: px / dim,
                                  }),
                                });
                              }}
                            />
                            <div className="te-nudge-btns">
                              {[-10, -1, 1, 10].map((step) => (
                                <button
                                  key={step}
                                  type="button"
                                  className="te-nudge-btn"
                                  onClick={() => {
                                    const d = dim || 1;
                                    updateFocused({
                                      region: clampRegionToVideo({
                                        ...focusedOp.region,
                                        [key]: focusedOp.region[key] + step / d,
                                      }),
                                    });
                                  }}
                                >
                                  {step > 0 ? `+${step}` : step}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="te-more-section">
                  <span className="te-label">{t("table.time")}</span>
                  <div className="te-row">
                    <label className="te-field te-field--grow">
                      <span className="te-label">{t("table.start")}</span>
                      <input
                        type="number"
                        className="te-select"
                        placeholder="0"
                        value={focusedOp.startTime ?? ""}
                        onChange={(e) =>
                          updateFocused({
                            startTime: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="te-field te-field--grow">
                      <span className="te-label">{t("table.end")}</span>
                      <input
                        type="number"
                        className="te-select"
                        placeholder={t("table.endPlaceholder")}
                        value={focusedOp.endTime ?? ""}
                        onChange={(e) =>
                          updateFocused({
                            endTime: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            <button type="button" className="te-danger" onClick={deleteFocusedOp}>
              <Trash2 size={13} />
              {t("table.deleteOp")}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
