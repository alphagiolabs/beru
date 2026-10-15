import { beruLocalUrl } from "../../utils/beru-url";
import { normalizeOverlayStyle } from "../../../shared/overlay-style.js";
import { overlaysAt } from "../../../shared/editor-timeline.js";

const boxStyle = (geometry) => ({
  left: `${geometry.x * 100}%`,
  top: `${geometry.y * 100}%`,
  width: `${geometry.w * 100}%`,
  height: `${geometry.h * 100}%`,
});

const FONT_STACKS = { Arial: "Arial, sans-serif", "Segoe UI": "'Segoe UI', sans-serif" };
const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" };

function rgba(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function textStyle(overlay) {
  const s = normalizeOverlayStyle(overlay.style);
  const offset = "calc(var(--overlay-size) * 0.06 * 100cqh)";
  return {
    ...boxStyle(overlay.geometry),
    "--overlay-size": s.size,
    color: rgba(s.color, s.textOpacity),
    fontFamily: FONT_STACKS[s.fontFamily],
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    justifyContent: JUSTIFY[s.textAlign],
    textAlign: s.textAlign,
    paddingInline: s.textAlign === "center" ? 0 : "calc(var(--overlay-size) * 0.25 * 100cqh)",
    background: s.bgEnabled ? rgba(s.bgColor, s.bgOpacity) : "none",
    WebkitTextStrokeWidth: `calc(var(--overlay-size) * ${s.borderWidth * 2} * 100cqh)`,
    WebkitTextStrokeColor: rgba(s.borderColor, 1),
    paintOrder: "stroke fill",
    textShadow: s.textShadowEnabled
      ? `${offset} ${offset} 0 ${rgba(s.textShadowColor, 1)}`
      : "none",
  };
}

export default function OverlayLayer({ overlays, playhead, assetsById, assetStatus }) {
  const visible = overlaysAt({ overlays }, playhead);
  return visible.map((overlay) => {
    if (overlay.kind === "text") {
      return (
        <div
          key={overlay.id}
          className="editor-overlay editor-overlay-text"
          style={textStyle(overlay)}
        >
          {overlay.text}
        </div>
      );
    }
    const asset = assetsById[overlay.assetId];
    if (!asset || (assetStatus[asset.id] ?? "ready") !== "ready") return null;
    return (
      <img
        key={overlay.id}
        className="editor-overlay editor-overlay-image"
        alt=""
        src={beruLocalUrl(asset.path, `${asset.mtimeMs}-${asset.sizeBytes}`)}
        style={boxStyle(overlay.geometry)}
      />
    );
  });
}
