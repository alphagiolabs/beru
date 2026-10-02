import { memo } from "react";
import { useT } from "../i18n/useT";
import { letterSpacingToPx } from "../utils/text-style";
import {
  drawtextLineSpacingPx,
  exportTextOverflows,
  layoutExportText,
  scaledSafeMargin,
  textBgEnabled,
  textBoxPad,
  textLayoutBounds,
  verticalAlignToFlex,
} from "../utils/text-layout";

function TextOverlay({
  screen,
  text,
  style = {},
  isFocused = false,
  showOutline = true,
  outlineColor = "rgba(168,85,247,0.4)",
  focusedOutlineColor = "var(--accent)",
  label,
  dimmed = false,
  interactive = false,
  cursor,
  onMouseDown,
  zIndex,
  showOverflowWarning = true,
}) {
  const t = useT();
  const rawText = text != null ? String(text).trim() : "";
  const displaySource = rawText.length > 0 ? rawText : null;

  if (!screen) return null;
  if (!displaySource && !label) return null;

  const scaleX = screen.sx || screen.sy || 1;
  const scaleY = screen.sy || screen.sx || 1;
  const nativeW = Math.round((screen.w || 0) / scaleX);
  const nativeH = Math.round((screen.h || 0) / scaleY);
  const safeX = scaledSafeMargin(style.safeMargin, scaleX);
  const safeY = scaledSafeMargin(style.safeMargin, scaleY);
  const bgOn = textBgEnabled(style);
  const boxPad = textBoxPad(style);
  const boxPadX = boxPad * scaleX;
  const boxPadY = boxPad * scaleY;
  const bounds = textLayoutBounds({ x: 0, y: 0, w: nativeW, h: nativeH }, style.safeMargin, boxPad);
  const lineHeight = style.lineHeight ?? 1.2;
  const layout = displaySource
    ? layoutExportText({
        text: displaySource,
        regionW: bounds.w,
        regionH: bounds.h,
        fontSize: style.fontSize ?? 32,
        lineHeight,
        textWrap: style.textWrap,
        autoFit: style.autoFit,
        truncate: style.truncate,
      })
    : null;
  const fontSizePx = layout ? Math.max(1, layout.fontSize * scaleY) : Math.max(1, 32 * scaleY);
  const lineBoxPx = layout
    ? fontSizePx + drawtextLineSpacingPx(layout.fontSize, lineHeight) * scaleY
    : fontSizePx;
  const hasOverflow =
    !!layout &&
    !style.autoFit &&
    exportTextOverflows(layout.displayText, layout.fontSize, lineHeight, bounds.w, bounds.h);
  const lines = layout ? String(layout.displayText).split("\n") : [];

  const baseWeight = style.fontWeight ?? (style.bold ? 700 : 400);
  const letterSpacing = letterSpacingToPx(style.letterSpacing) * scaleX;
  const textOpacity = style.textOpacity ?? 1;
  const align = style.textAlign || "left";
  const shadowX = Number(style.textShadowOffsetX ?? 2) * scaleX;
  const shadowY = Number(style.textShadowOffsetY ?? 2) * scaleY;
  const textShadow = style.textShadowEnabled
    ? `${shadowX}px ${shadowY}px 0 ${style.textShadowColor || "black"}`
    : "none";

  const outlineStyle = showOutline
    ? hasOverflow
      ? "2px solid var(--rose)"
      : isFocused
        ? `2px solid ${focusedOutlineColor}`
        : `1px dashed ${outlineColor}`
    : hasOverflow
      ? "2px solid var(--rose)"
      : "none";

  return (
    <div
      data-text-overlay="true"
      data-interactive={interactive ? "true" : "false"}
      className={`absolute ${interactive ? "pointer-events-auto" : "pointer-events-none"}`}
      onMouseDown={onMouseDown}
      style={{
        left: screen.x,
        top: screen.y,
        width: screen.w,
        height: screen.h,
        cursor,
        zIndex,
        outline: outlineStyle,
        outlineOffset: "1px",
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      {label && !displaySource && (
        <div
          style={{
            position: "absolute",
            top: -18,
            left: 0,
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            fontSize: "9px",
            fontWeight: 600,
            padding: "1px 6px",
            borderRadius: "3px 3px 0 0",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      )}

      {showOverflowWarning && hasOverflow && (
        <div
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            zIndex: 2,
            background: "var(--rose)",
            color: "var(--text-on-rose)",
            fontSize: "8px",
            fontWeight: 700,
            padding: "1px 5px",
            borderRadius: "3px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            pointerEvents: "none",
          }}
        >
          {t("preview.overflow")}
        </div>
      )}

      {bgOn && displaySource && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: style.bgColor || "black",
            opacity: style.bgOpacity ?? 0.65,
            // FFmpeg drawbox is axis-aligned. Radius made preview diverge from export.
            borderRadius: 0,
          }}
        />
      )}

      {displaySource && layout && (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: verticalAlignToFlex(style.verticalAlign || "top"),
            padding: `${safeY + boxPadY}px ${safeX + boxPadX}px`,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <div
            data-export-layout="true"
            data-display-text={layout.displayText}
            data-font-size={String(layout.fontSize)}
            style={{
              width: "100%",
              maxWidth: "100%",
              margin: 0,
              color: style.fontColor || "white",
              opacity: textOpacity,
              fontSize: `${fontSizePx}px`,
              fontFamily: `"${style.fontFamily || "Arial"}", sans-serif`,
              fontWeight: baseWeight,
              fontStyle: style.italic ? "italic" : "normal",
              letterSpacing: `${letterSpacing}px`,
              textAlign: align,
              textShadow,
              WebkitTextStroke:
                style.borderWidth > 0
                  ? `${style.borderWidth * scaleY}px ${style.borderColor || "black"}`
                  : "none",
            }}
          >
            {lines.map((line, index) => (
              <div
                key={index}
                style={{
                  height: `${lineBoxPx}px`,
                  lineHeight: `${fontSizePx}px`,
                  whiteSpace: "pre",
                  overflow: "hidden",
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(TextOverlay);
