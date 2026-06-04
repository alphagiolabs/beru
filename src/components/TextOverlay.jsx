import { letterSpacingToPx } from "../utils/letter-spacing";

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
}) {
  if (!screen) return null;

  const displayText = text != null && String(text).length > 0 ? String(text) : null;
  if (!displayText && !label) return null;

  const fontSize = Math.max(1, (style.fontSize || 24) * screen.sy);
  const bgOn = style.bgEnabled !== false;
  const baseWeight = style.fontWeight ?? (style.bold ? 700 : 400);
  const letterSpacing = letterSpacingToPx(style.letterSpacing) * screen.sy;
  const textOpacity = style.textOpacity ?? 1;
  const align = style.textAlign || "left";
  const boxPad = bgOn ? Math.max(2, (style.boxBorderWidth || 4) * screen.sy) : 0;

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
        outline: showOutline
          ? isFocused
            ? `2px solid ${focusedOutlineColor}`
            : `1px dashed ${outlineColor}`
          : "none",
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
            color: style.fontColor || "white",
            opacity: textOpacity,
            fontSize: `${fontSize}px`,
            fontFamily: `"${style.fontFamily || "Arial"}", sans-serif`,
            fontWeight: baseWeight,
            fontStyle: style.italic ? "italic" : "normal",
            letterSpacing: `${letterSpacing}px`,
            textAlign: align,
            padding: `${boxPad}px`,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            WebkitTextStroke:
              style.borderWidth > 0
                ? `${style.borderWidth * screen.sy}px ${style.borderColor || "black"}`
                : "none",
          }}
        >
          {displayText}
        </div>
      )}
    </div>
  );
}
