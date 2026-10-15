import TextOverlay from "../TextOverlay";
import useVideoSecond from "../../hooks/useVideoSecond";
import { formatClockBlocks, splitClockRegion } from "../../utils/datetime-stamp";
import { textBoxPad } from "../../utils/text-layout";

const CLOCK_TEXT_LAYOUT = { autoFit: false, textWrap: false, truncate: "none", lineHeight: 1 };

export default function DateTimeOverlay({
  videoRef,
  screen,
  cssTransform,
  op,
  fallbackText,
  showOutline = false,
  outlineColor = "rgba(168,85,247,0.4)",
  dimmed = false,
  interactive = false,
  cursor,
  onMouseDown,
  zIndex,
}) {
  const second = useVideoSecond(videoRef);
  if (!screen) return null;
  const blocks = formatClockBlocks(op, second);
  const texts = blocks.length ? blocks : fallbackText ? [fallbackText] : [];
  const sx = screen.sx || screen.sy || 1;
  const sy = screen.sy || screen.sx || 1;
  const native = { x: 0, y: 0, w: Math.round(screen.w / sx), h: Math.round(screen.h / sy) };
  const inset = Math.max(0, Math.trunc(Number(op.safeMargin) || 0)) + textBoxPad(op);
  const boxes = splitClockRegion(
    native,
    texts.map((text) => text.length),
    op.fontSize ?? 32,
    inset,
  );
  const style = { ...op, ...CLOCK_TEXT_LAYOUT };

  return (
    <div
      data-datetime-overlay="true"
      className={`absolute ${interactive ? "pointer-events-auto" : "pointer-events-none"}`}
      onMouseDown={onMouseDown}
      style={{
        left: screen.x,
        top: screen.y,
        width: screen.w,
        height: screen.h,
        cursor,
        zIndex,
        outline: showOutline ? `1px dashed ${outlineColor}` : "none",
        outlineOffset: "1px",
        opacity: dimmed ? 0.55 : 1,
        transform: cssTransform,
        transformOrigin: "center",
      }}
    >
      {texts.map((text, index) => (
        <TextOverlay
          key={index}
          screen={{
            x: boxes[index].x * sx,
            y: boxes[index].y * sy,
            w: boxes[index].w * sx,
            h: boxes[index].h * sy,
            sx,
            sy,
          }}
          text={text}
          style={style}
          showOutline={false}
          showOverflowWarning={false}
          overflowOutline={false}
        />
      ))}
    </div>
  );
}
