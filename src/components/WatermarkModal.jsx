import { X, Type, Image as ImageIcon, Upload } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { storeErrorText } from "../utils/store-errors";
import { beruLocalUrl, imageVersion } from "../utils/beru-url";
import { WATERMARK_POSITIONS } from "../utils/watermark-position";
import { Button } from "./ui/Button";
import { PositionIcon } from "./ui/PositionIcon";

export default function WatermarkModal() {
  const t = useT();
  const show = useEditorStore((s) => s.showWatermarkModal);
  const wm = useEditorStore((s) => s.watermark);
  const setWatermark = useEditorStore((s) => s.setWatermark);
  const showToast = useEditorStore((s) => s.showToast);
  const close = () => useEditorStore.getState().setShowWatermarkModal(false);

  if (!show) return null;

  const isText = wm.type === "text";
  const imageSrc = wm.imagePath ? beruLocalUrl(wm.imagePath, wm.imageV) : "";

  return (
    <div className="cap-modal-overlay" onClick={close}>
      <div className="cap-modal-panel max-w-[420px] w-full" onClick={(e) => e.stopPropagation()}>
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-sm font-semibold">{t("header.watermark")}</span>
          <Button
            type="button"
            onClick={close}
            variant="tertiary"
            size="icon"
            className="text-[var(--text-dim)] hover:bg-white/10"
            style={{ color: "var(--text-dim)" }}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </Button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={wm.enabled}
              onChange={(e) => setWatermark({ enabled: e.target.checked })}
              className="accent-[var(--accent)] w-4 h-4"
            />
            <span className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
              {t("watermark.enable")}
            </span>
          </label>

          <div
            className="flex rounded overflow-hidden border"
            style={{ borderColor: "var(--border)" }}
          >
            <Button
              type="button"
              onClick={() => setWatermark({ type: "text" })}
              variant="tertiary"
              size="sm"
              className="watermark-type-btn flex-1 !rounded-none !py-2 !text-[11px]"
              aria-pressed={isText}
              style={{
                background: isText ? "var(--accent)" : "transparent",
                color: isText ? "var(--bg-app)" : "var(--text-dim)",
              }}
            >
              <Type size={13} /> {t("watermark.typeText")}
            </Button>
            <Button
              type="button"
              onClick={() => setWatermark({ type: "image" })}
              variant="tertiary"
              size="sm"
              className="watermark-type-btn flex-1 !rounded-none !py-2 !text-[11px]"
              aria-pressed={!isText}
              style={{
                background: !isText ? "var(--accent)" : "transparent",
                color: !isText ? "var(--bg-app)" : "var(--text-dim)",
              }}
            >
              <ImageIcon size={13} /> {t("watermark.typeImage")}
            </Button>
          </div>

          {isText && (
            <div className="space-y-3">
              <label>
                <span
                  className="text-[9px] font-semibold tracking-wider uppercase mb-1 block"
                  style={{ color: "var(--text-dim)" }}
                >
                  {t("watermark.typeText")}
                </span>
                <input
                  type="text"
                  value={wm.text}
                  onChange={(e) => setWatermark({ text: e.target.value })}
                  placeholder={t("modal.watermark.textPlaceholder")}
                  className="cap-input w-full text-[12px]"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span
                    className="text-[9px] font-semibold tracking-wider uppercase mb-1 block"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {t("table.size")}
                  </span>
                  <input
                    type="number"
                    value={wm.fontSize}
                    onChange={(e) => setWatermark({ fontSize: Number(e.target.value) || 18 })}
                    min={8}
                    max={120}
                    className="cap-input w-full font-mono text-[11px]"
                  />
                </label>
                <label>
                  <span
                    className="text-[9px] font-semibold tracking-wider uppercase mb-1 block"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {t("table.color")}
                  </span>
                  <div className="flex gap-1.5 items-center">
                    <input
                      type="color"
                      value={wm.fontColor}
                      onChange={(e) => setWatermark({ fontColor: e.target.value })}
                      className="w-8 h-8 rounded cursor-pointer border-0"
                    />
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                      {wm.fontColor}
                    </span>
                  </div>
                </label>
              </div>
            </div>
          )}

          {!isText && (
            <div className="space-y-3">
              <div>
                <span
                  className="text-[9px] font-semibold tracking-wider uppercase mb-1 block"
                  style={{ color: "var(--text-dim)" }}
                >
                  {t("watermark.typeImage")}
                </span>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={wm.imagePath ? wm.imagePath.split(/[\\/]/).pop() : ""}
                    placeholder={t("modal.watermark.imagePlaceholder")}
                    readOnly
                    className="cap-input flex-1 font-mono text-[10px] truncate"
                  />
                  <Button
                    type="button"
                    onClick={async () => {
                      const res = await window.api?.pickImage();
                      if (!res || res.canceled) return;
                      if (!res.success) {
                        showToast?.({
                          kind: "err",
                          text: storeErrorText(t, res, "errors.imageReadFailed"),
                        });
                        return;
                      }
                      const r = await window.api?.statImage(res.path);
                      if (r?.success) {
                        setWatermark({ imagePath: res.path, imageV: imageVersion(r) });
                      } else {
                        showToast?.({
                          kind: "err",
                          text: storeErrorText(t, r, "errors.imageReadFailed"),
                        });
                      }
                    }}
                    variant="secondary"
                    size="sm"
                    className="!text-[10px] !px-2"
                  >
                    <Upload size={12} /> {t("logo.pick")}
                  </Button>
                  {wm.imagePath && (
                    <Button
                      type="button"
                      onClick={() => setWatermark({ imagePath: "", imageV: "" })}
                      variant="tertiary"
                      size="icon"
                      title={t("common.remove")}
                      aria-label={t("common.remove")}
                      className="text-[var(--rose)]"
                      style={{ color: "var(--text-rose)" }}
                    >
                      <X size={12} />
                    </Button>
                  )}
                </div>
                {imageSrc && (
                  <div
                    className="rounded overflow-hidden border mt-2"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <img
                      src={imageSrc}
                      alt={t("watermark.previewAlt")}
                      className="block w-full max-h-24 object-contain"
                      style={{ background: "var(--bg-app)" }}
                    />
                  </div>
                )}
              </div>
              <div>
                <span
                  className="text-[9px] font-semibold tracking-wider uppercase mb-1 block"
                  style={{ color: "var(--text-dim)" }}
                >
                  {t("watermark.scale")}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0.1}
                    max={3}
                    step={0.1}
                    value={wm.scale}
                    onChange={(e) => setWatermark({ scale: Number(e.target.value) })}
                    className="flex-1"
                  />
                  <span
                    className="font-mono text-xs w-10 text-right"
                    style={{ color: "var(--text-accent)" }}
                  >
                    {wm.scale.toFixed(1)}x
                  </span>
                </div>
              </div>
            </div>
          )}

          <div>
            <span
              className="text-[9px] font-semibold tracking-wider uppercase mb-1 block"
              style={{ color: "var(--text-dim)" }}
            >
              {t("table.opacity")}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={wm.opacity}
                onChange={(e) => setWatermark({ opacity: Number(e.target.value) })}
                className="flex-1"
              />
              <span
                className="font-mono text-xs w-10 text-right"
                style={{ color: "var(--text-accent)" }}
              >
                {Math.round(wm.opacity * 100)}%
              </span>
            </div>
          </div>

          <div>
            <span
              className="text-[9px] font-semibold tracking-wider uppercase mb-1 block"
              style={{ color: "var(--text-dim)" }}
            >
              {t("watermark.position")}
            </span>
            <div className="grid grid-cols-3 gap-1">
              {WATERMARK_POSITIONS.map((pos) => (
                <Button
                  type="button"
                  key={pos.key}
                  onClick={() => setWatermark({ position: pos.key })}
                  variant="secondary"
                  size="sm"
                  className="!text-xs !p-2"
                  style={{
                    background: wm.position === pos.key ? "var(--accent)" : "var(--bg-elevated)",
                    color: wm.position === pos.key ? "var(--bg-app)" : "var(--text-dim)",
                    borderColor: wm.position === pos.key ? "var(--accent)" : "var(--border)",
                  }}
                  title={t(`position.${pos.key}`)}
                  aria-label={t(`position.${pos.key}`)}
                >
                  <PositionIcon position={pos.key} size={14} strokeWidth={2} />
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
