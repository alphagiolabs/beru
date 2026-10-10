import { Fragment } from "react";
import RegionBlurPreview from "./RegionBlurPreview";
import DelogoLivePreview from "../DelogoLivePreview";
import TextOverlay from "../TextOverlay";
import { isOpActive } from "../../utils/operation";
import { beruLocalUrl } from "../../utils/beru-url";
import { useT } from "../../i18n/useT";

function RegionHitLayer({ screen, dragging, disabled, onDragStart, title }) {
  if (!screen || disabled) return null;
  return (
    <div
      className={`absolute ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      style={{
        left: screen.x,
        top: screen.y,
        width: screen.w,
        height: screen.h,
        zIndex: 40,
        pointerEvents: "auto",
        background: "transparent",
      }}
      onMouseDown={onDragStart}
      title={title}
    />
  );
}

export default function OperationOverlays({
  ops,
  videoRef,
  currentTimeRef,
  sidebarMode,
  activeTool,
  selectedOperationIdx,
  draggingOp,
  showFfmpegPreview,
  showFfmpegOverlay,
  logoComparisonVisible,
  currentRegion,
  onRegionOpDragStart,
  onImageDragStart,
}) {
  const t = useT();
  if (logoComparisonVisible || showFfmpegOverlay) return null;
  return ops.map(({ op, opIdx, screen: s }) => {
    if (!s) return null;
    if (op.mode === "blur") {
      const isSelected = selectedOperationIdx === opIdx;
      const isDragging = draggingOp?.opIdx === opIdx;
      return (
        <Fragment key={op.id}>
          <RegionBlurPreview
            videoRef={videoRef}
            region={op.region}
            blurStrength={op.blurStrength}
            startTime={op.startTime}
            endTime={op.endTime}
            outline={isSelected ? "none" : "2px solid rgba(0,240,234,0.6)"}
          />
          <RegionHitLayer
            screen={s}
            dragging={isDragging}
            disabled={
              !isOpActive(op, currentTimeRef.current) ||
              (showFfmpegPreview && sidebarMode !== "logo") ||
              activeTool === "pan"
            }
            onDragStart={(e) => onRegionOpDragStart(opIdx, e)}
            title={t("preview.dragRegion")}
          />
        </Fragment>
      );
    }
    if (op.mode === "crop") {
      const isSelected = selectedOperationIdx === opIdx;
      const isDragging = draggingOp?.opIdx === opIdx;
      return (
        <Fragment key={op.id}>
          <div
            className="absolute pointer-events-none z-10"
            style={{
              left: s.x,
              top: s.y,
              width: s.w,
              height: s.h,
              outline: isSelected ? "none" : "2px dashed var(--amber)",
              outlineOffset: "-1px",
            }}
          />
          <RegionHitLayer
            screen={s}
            dragging={isDragging}
            disabled={
              !isOpActive(op, currentTimeRef.current) ||
              (showFfmpegPreview && sidebarMode !== "logo") ||
              activeTool === "pan"
            }
            onDragStart={(e) => onRegionOpDragStart(opIdx, e)}
            title={t("preview.dragRegion")}
          />
        </Fragment>
      );
    }
    if (op.mode === "delogo") {
      const isDragging = draggingOp?.opIdx === opIdx;
      const hitLayer = (
        <RegionHitLayer
          screen={s}
          dragging={isDragging}
          disabled={
            !isOpActive(op, currentTimeRef.current) ||
            (showFfmpegPreview && sidebarMode !== "logo") ||
            activeTool === "pan"
          }
          onDragStart={(e) => onRegionOpDragStart(opIdx, e)}
          title={t("preview.dragRegion")}
        />
      );
      return (
        <Fragment key={op.id}>
          <DelogoLivePreview videoRef={videoRef} operation={op} />
          {hitLayer}
        </Fragment>
      );
    }
    if (op.mode === "image" && op.imagePath) {
      const isDragging = draggingOp?.opIdx === opIdx;
      return (
        <div
          key={op.id}
          className={`absolute z-40 ${isDragging ? "cursor-grabbing" : "cursor-grab hover:cursor-grab"}`}
          style={{
            left: s.x,
            top: s.y,
            width: s.w,
            height: s.h,
            opacity: op.imageOpacity ?? 1,
            outline: isDragging
              ? "2px solid rgba(16,185,129,1)"
              : "1px dashed rgba(16,185,129,0.6)",
            pointerEvents: "auto",
          }}
          onMouseDown={(e) => onImageDragStart(op, opIdx, e)}
        >
          <img
            src={beruLocalUrl(op.imagePath, op.imageV)}
            alt={op.imagePath.split(/[\\/]/).pop()}
            className="w-full h-full"
            style={{ objectFit: "fill" }}
            draggable={false}
          />
        </div>
      );
    }
    if (op.mode === "text" && op.text && sidebarMode !== "batch" && !showFfmpegOverlay) {
      const textInteractive = !currentRegion;
      const isDragging = draggingOp?.opIdx === opIdx;
      return (
        <TextOverlay
          key={op.id}
          screen={s}
          text={op.text}
          style={op}
          showOutline={(!showFfmpegPreview || sidebarMode === "logo") && textInteractive}
          showOverflowWarning={!showFfmpegPreview || sidebarMode === "logo"}
          interactive={textInteractive}
          cursor={textInteractive ? (isDragging ? "grabbing" : "grab") : undefined}
          zIndex={textInteractive ? 40 : 20}
          onMouseDown={textInteractive ? (e) => onImageDragStart(op, opIdx, e) : undefined}
        />
      );
    }
    return null;
  });
}
