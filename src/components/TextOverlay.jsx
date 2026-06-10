import { useLayoutEffect, useRef, useState } from "react";
import { letterSpacingToPx } from "../utils/letter-spacing";
import {
  binarySearchAutoFitFontSize,
  elementOverflows,
  getTextLayoutCss,
  scaledSafeMargin,
  verticalAlignToFlex,
} from "../utils/text-layout";

/**
 * Renders a text overlay aligned to a video region (preview only).
 * screen: return value of regionToScreen()
 * style: operation-style fields (fontSize, fontColor, …)
 */
export default function TextOverlay({
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
  const measureRef = useRef(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [resolvedFontPx, setResolvedFontPx] = useState(null);

  const displayText = text != null && String(text).length > 0 ? String(text) : null;

  const scaleX = screen?.sx || screen?.sy || 1;
  const scaleY = screen?.sy || screen?.sx || 1;
  const baseFontPx = Math.max(1, (style.fontSize || 24) * scaleY);
  const safeX = scaledSafeMargin(style.safeMargin, scaleX);
  const safeY = scaledSafeMargin(style.safeMargin, scaleY);
  const bgOn = style.bgEnabled !== false;
  const boxPadX = bgOn ? Math.max(2, (style.boxBorderWidth || 4) * scaleX) : 0;
  const boxPadY = bgOn ? Math.max(2, (style.boxBorderWidth || 4) * scaleY) : 0;
  const measureWidth = Math.max(0, (screen?.w || 0) - safeX * 2);
  const measureHeight = Math.max(0, (screen?.h || 0) - safeY * 2);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el || !displayText || !screen) {
      setHasOverflow(false);
      setResolvedFontPx(null);
      return;
    }

    if (measureWidth <= 0 || measureHeight <= 0) {
      setHasOverflow(true);
      setResolvedFontPx(baseFontPx);
      return;
    }

    const minPx = Math.max(6, 8 * scaleY);
    const maxPx = baseFontPx;
    const measureBounds = { width: measureWidth, height: measureHeight };

    const applyFont = (px) => {
      el.style.fontSize = `${px}px`;
    };

    if (style.autoFit) {
      const fitted = binarySearchAutoFitFontSize(
        (px) => {
          applyFont(px);
          return !elementOverflows(el, 1, measureBounds);
        },
        { minPx, maxPx },
      );
      applyFont(fitted);
      setResolvedFontPx(fitted);
      setHasOverflow(false);
      return;
    }

    applyFont(maxPx);
    setResolvedFontPx(maxPx);
    setHasOverflow(elementOverflows(el, 1, measureBounds));
  }, [
    displayText,
    style.autoFit,
    style.lineHeight,
    style.textWrap,
    style.truncate,
    style.safeMargin,
    style.fontSize,
    style.fontFamily,
    style.fontWeight,
    style.letterSpacing,
    style.bold,
    style.italic,
    style.boxBorderWidth,
    style.bgEnabled,
    screen?.w,
    screen?.h,
    screen?.sx,
    screen?.sy,
    baseFontPx,
    measureWidth,
    measureHeight,
  ]);

  if (!screen) return null;
  if (!displayText && !label) return null;

  const fontSize = resolvedFontPx ?? baseFontPx;
  const baseWeight = style.fontWeight ?? (style.bold ? 700 : 400);
  const letterSpacing = letterSpacingToPx(style.letterSpacing) * scaleX;
  const textOpacity = style.textOpacity ?? 1;
  const align = style.textAlign || "left";
  const shadowX = Number(style.textShadowOffsetX ?? 2) * scaleX;
  const shadowY = Number(style.textShadowOffsetY ?? 2) * scaleY;
  const textShadow = style.textShadowEnabled
    ? `${shadowX}px ${shadowY}px 0 ${style.textShadowColor || "black"}`
    : "none";

  const overflowActive = hasOverflow && !style.autoFit;
  const outlineStyle = showOutline
    ? overflowActive
      ? "2px solid var(--rose)"
      : isFocused
        ? `2px solid ${focusedOutlineColor}`
        : `1px dashed ${outlineColor}`
    : overflowActive
      ? "2px solid var(--rose)"
      : "none";

  return (
    <div
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
      {label && !displayText && (
        <div
          style={{
            position: "absolute",
            top: -18,
            left: 0,
            background: isFocused ? focusedOutlineColor : "rgba(168,85,247,0.9)",
            color: "white",
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

      {displayText && (
        <div
          ref={measureRef}
          data-overflow-measurer="true"
          aria-hidden="true"
          style={{
            ...getTextLayoutCss(style),
            position: "absolute",
            left: 0,
            top: 0,
            width: `${measureWidth}px`,
            maxWidth: `${measureWidth}px`,
            maxHeight: `${measureHeight}px`,
            padding: 0,
            visibility: "hidden",
            pointerEvents: "none",
            color: "transparent",
            fontSize: `${fontSize}px`,
            fontFamily: `"${style.fontFamily || "Arial"}", sans-serif`,
            fontWeight: baseWeight,
            fontStyle: style.italic ? "italic" : "normal",
            letterSpacing: `${letterSpacing}px`,
            textAlign: align,
            textShadow: "none",
            WebkitTextStroke: "none",
          }}
        >
          {displayText}
        </div>
      )}

      {showOverflowWarning && overflowActive && (
        <div
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            zIndex: 2,
            background: "rgba(244,63,94,0.92)",
            color: "white",
            fontSize: "8px",
            fontWeight: 700,
            padding: "1px 5px",
            borderRadius: "3px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            pointerEvents: "none",
          }}
        >
          Desborda
        </div>
      )}

      {bgOn && displayText && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: style.bgColor || "black",
            opacity: style.bgOpacity ?? 0.65,
            borderRadius: `${Math.max(3, 6 * screen.sy)}px`,
          }}
        />
      )}

      {displayText && (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: verticalAlignToFlex(style.verticalAlign || "top"),
            padding: `${safeY}px ${safeX}px`,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              ...getTextLayoutCss(style),
              color: style.fontColor || "white",
              opacity: textOpacity,
              fontSize: `${fontSize}px`,
              fontFamily: `"${style.fontFamily || "Arial"}", sans-serif`,
              fontWeight: baseWeight,
              fontStyle: style.italic ? "italic" : "normal",
              letterSpacing: `${letterSpacing}px`,
              textAlign: align,
              padding: `${boxPadY}px ${boxPadX}px`,
              textShadow,
              WebkitTextStroke:
                style.borderWidth > 0
                  ? `${style.borderWidth * scaleY}px ${style.borderColor || "black"}`
                  : "none",
            }}
          >
            {displayText}
          </div>
        </div>
      )}
    </div>
  );
}
