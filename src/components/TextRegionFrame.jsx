import { cursorForHandle, RESIZE_HANDLES } from "../utils/region-interaction";

/** Visible handle (clean Figma-style disc) */
const HANDLE_VISUAL = 8;
/** Hit pad — larger than visual so corners stay easy to grab */
const HANDLE_HIT = 18;

/**
 * Elegant corner/edge handles: small white disc + thin accent ring.
 * Hit area is larger than the painted disc.
 */
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
    // Centered visual disc via radial layers
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

/**
 * DOM selection chrome for a text region — clean Figma/Canva style.
 */
export default function TextRegionFrame({
  screen,
  region,
  gesture,
  color = "var(--accent-brand, #00b4b0)",
  showEdgeHandles = true,
  zIndex = 50,
  label,
  disabled = false,
}) {
  if (!screen || !region || !gesture) return null;

  const handles = showEdgeHandles
    ? RESIZE_HANDLES
    : RESIZE_HANDLES.filter((h) => ["tl", "tr", "bl", "br"].includes(h));

  const dragging = !disabled && gesture.active;

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
        cursor: disabled ? "default" : dragging ? "grabbing" : "grab",
        overflow: "visible",
        pointerEvents: disabled ? "none" : "auto",
        touchAction: "none",
        boxSizing: "border-box",
        // Thin clean border; soft outer ring so it reads on light and dark frames
        border: `1.5px solid ${color}`,
        borderRadius: 2,
        boxShadow: dragging
          ? `0 0 0 1px rgba(0,0,0,0.2), 0 0 0 3px color-mix(in srgb, ${color} 35%, transparent)`
          : `0 0 0 1px rgba(0,0,0,0.18)`,
        background: "transparent",
        // No transition while dragging (feels sticky); ease only when idle
        transition: dragging ? "none" : "box-shadow 120ms ease",
      }}
      onPointerDown={(e) => {
        if (disabled) return;
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

      {handles.map((id) => (
        <div
          key={id}
          data-handle={id}
          role="presentation"
          title="Redimensionar"
          style={handleStyle(id, color)}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (disabled) return;
            gesture.beginResize(e, region, id);
          }}
        />
      ))}
    </div>
  );
}
