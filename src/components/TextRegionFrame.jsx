import { cursorForHandle, RESIZE_HANDLES } from "../utils/region-interaction";

const HANDLE_VISUAL = 8;
const HANDLE_HIT = 18;

function handleStyle(id, accent) {
  const half = HANDLE_HIT / 2;
  const base = {
    position: "absolute",
    width: HANDLE_HIT,
    height: HANDLE_HIT,
    margin: 0,
    padding: 0,
    boxSizing: "border-box",
    border: "none",
    borderRadius: "50%",
    background: "transparent",
    backgroundImage: [
      `radial-gradient(circle ${HANDLE_VISUAL / 2}px at center, #ffffff 0, #ffffff 58%, transparent 60%)`,
      `radial-gradient(circle ${HANDLE_VISUAL / 2 + 1.25}px at center, ${accent} 0, ${accent} 100%, transparent 101%)`,
    ].join(", "),
    boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
    zIndex: 3,
    touchAction: "none",
    pointerEvents: "auto",
    cursor: cursorForHandle(id),
  };
  const map = {
    tl: { left: -half, top: -half },
    tc: { left: `calc(50% - ${half}px)`, top: -half },
    tr: { right: -half, top: -half },
    ml: { left: -half, top: `calc(50% - ${half}px)` },
    mr: { right: -half, top: `calc(50% - ${half}px)` },
    bl: { left: -half, bottom: -half },
    bc: { left: `calc(50% - ${half}px)`, bottom: -half },
    br: { right: -half, bottom: -half },
  };
  return { ...base, ...map[id] };
}

export default function TextRegionFrame({
  screen,
  region,
  gesture,
  color = "var(--accent-brand, #00b4b0)",
  zIndex = 50,
  label,
}) {
  if (!screen || !region || !gesture) return null;

  const dragging = gesture.active;

  return (
    <div
      data-text-region-frame="true"
      className="absolute"
      style={{
        left: screen.x,
        top: screen.y,
        width: Math.max(1, screen.w),
        height: Math.max(1, screen.h),
        zIndex,
        cursor: dragging ? "grabbing" : "grab",
        overflow: "visible",
        pointerEvents: "auto",
        touchAction: "none",
        boxSizing: "border-box",
        border: `1.5px solid ${color}`,
        borderRadius: 2,
        boxShadow: dragging
          ? `0 0 0 1px rgba(0,0,0,0.2), 0 0 0 3px color-mix(in srgb, ${color} 35%, transparent)`
          : `0 0 0 1px rgba(0,0,0,0.18)`,
        background: "transparent",
        transition: dragging ? "none" : "box-shadow 120ms ease",
      }}
      onPointerDown={(e) => {
        if (e.target?.dataset?.handle) return;
        gesture.beginMove(e, region);
      }}
    >
      {label ? (
        <div
          className="absolute left-0 whitespace-nowrap pointer-events-none select-none"
          style={{
            top: -20,
            background: color,
            color: "#0a0a0a",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.02em",
            padding: "2px 7px",
            borderRadius: 4,
            lineHeight: 1.3,
            boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          }}
        >
          {label}
        </div>
      ) : null}

      {RESIZE_HANDLES.map((id) => (
        <div
          key={id}
          data-handle={id}
          role="presentation"
          title="Redimensionar"
          style={handleStyle(id, color)}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            gesture.beginResize(e, region, id);
          }}
        />
      ))}
    </div>
  );
}
