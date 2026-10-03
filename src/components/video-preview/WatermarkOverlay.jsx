export default function WatermarkOverlay({ watermark, videoRef }) {
  const video = videoRef.current;
  if (!video) return null;
  const vh = video.videoHeight || 1;
  const layoutW = video.offsetWidth || 1;
  const layoutH = video.offsetHeight || 1;
  const sy = layoutH / vh;
  const margin = 10;
  const pos = watermark.position || "bottom-right";
  const posMap = {
    "top-left": { left: margin, top: margin },
    "top-center": { left: "50%", top: margin, transform: "translateX(-50%)" },
    "top-right": { right: margin, top: margin },
    "center-left": { left: margin, top: "50%", transform: "translateY(-50%)" },
    center: { left: "50%", top: "50%", transform: "translate(-50%, -50%)" },
    "center-right": { right: margin, top: "50%", transform: "translateY(-50%)" },
    "bottom-left": { left: margin, bottom: margin },
    "bottom-center": {
      left: "50%",
      bottom: margin,
      transform: "translateX(-50%)",
    },
    "bottom-right": { right: margin, bottom: margin },
  };
  const posStyle = posMap[pos] || posMap["bottom-right"];
  const boxStyle = {
    position: "absolute",
    left: 0,
    top: 0,
    width: layoutW,
    height: layoutH,
    pointerEvents: "none",
    zIndex: 35,
  };
  if (watermark.type === "text" && watermark.text) {
    const fontSize = Math.max(8, (watermark.fontSize || 18) * sy);
    return (
      <div className="absolute pointer-events-none z-[35]" style={boxStyle}>
        <div
          className="absolute"
          style={{
            ...posStyle,
            opacity: watermark.opacity ?? 0.5,
            fontSize: `${fontSize}px`,
            fontFamily: `"${watermark.fontFamily || "Arial"}", sans-serif`,
            color: watermark.fontColor || "#ffffff",
            textShadow: "1px 1px 3px rgba(0,0,0,0.7)",
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          {watermark.text}
        </div>
      </div>
    );
  }
  const imageSrc =
    watermark.imageDataUrl ||
    (watermark.imagePath ? `beru://local/${encodeURIComponent(watermark.imagePath)}` : "");
  if (watermark.type === "image" && imageSrc) {
    const baseSize = 80 * sy;
    const scaledSize = baseSize * (watermark.scale || 1);
    return (
      <div className="absolute pointer-events-none z-[35]" style={boxStyle}>
        <div className="absolute" style={{ ...posStyle, opacity: watermark.opacity ?? 0.5 }}>
          <img
            src={imageSrc}
            alt=""
            style={{
              height: `${scaledSize}px`,
              width: "auto",
              objectFit: "contain",
            }}
            draggable={false}
          />
        </div>
      </div>
    );
  }
  return null;
}
