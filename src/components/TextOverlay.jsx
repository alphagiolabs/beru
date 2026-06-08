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
  const textRef = useRef(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [resolvedFontPx, setResolvedFontPx] = useState(null);

  const displayText = text != null && String(text).length > 0 ? String(text) : null;

  const baseFontPx = Math.max(1, (style.fontSize || 24) * (screen?.sy || 1));
  const safePx = scaledSafeMargin(style.safeMargin, screen?.sy || 1);
  const boxPad =
    style.bgEnabled !== false ? Math.max(2, (style.boxBorderWidth || 4) * (screen?.sy || 1)) : 0;

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !displayText || !screen) {
      setHasOverflow(false);
      setResolvedFontPx(null);
      return;
    }

    const minPx = Math.max(6, 8 * screen.sy);
    const maxPx = baseFontPx;

    const applyFont = (px) => {
      el.style.fontSize = `${px}px`;
    };

    if (style.autoFit) {
      const fitted = binarySearchAutoFitFontSize(
        (px) => {
          applyFont(px);
          return !elementOverflows(el);
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
    setHasOverflow(elementOverflows(el));
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
    screen?.sy,
    baseFontPx,
  ]);

  if (!screen) return null;
  if (!displayText && !label) return null;

  const fontSize = resolvedFontPx ?? baseFontPx;
  const bgOn = style.bgEnabled !== false;
  const baseWeight = style.fontWeight ?? (style.bold ? 700 : 400);
  const letterSpacing = letterSpacingToPx(style.letterSpacing) * screen.sy;
  const textOpacity = style.textOpacity ?? 1;
  const align = style.textAlign || "left";
  const shadowX = Number(style.textShadowOffsetX ?? 2) * screen.sy;
  const shadowY = Number(style.textShadowOffsetY ?? 2) * screen.sy;
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
            padding: `${safePx}px`,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <div
            ref={textRef}
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
              padding: `${boxPad}px`,
              textShadow,
              WebkitTextStroke:
                style.borderWidth > 0
                  ? `${style.borderWidth * screen.sy}px ${style.borderColor || "black"}`
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
