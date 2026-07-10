import { regionToScreen, isRegionUsable } from "../../utils/video-utils";
import TextOverlay from "../TextOverlay";

/** Batch-mode text overlays and draft-region sample text. */
export default function BatchTextDragLayer({
  sidebarMode,
  selectedIdx,
  showFfmpegOverlay,
  batchRegionPreviews,
  selectedTemplateRegionId,
  currentRegion,
  videoRef,
  draggingBatchText,
  textSelectionActive,
  textRegionGestureActive,
  globalTextStyle,
  onBatchTextDragStart,
}) {
  if (sidebarMode !== "batch" || showFfmpegOverlay) return null;

  return (
    <>
      {selectedIdx >= 0 &&
        batchRegionPreviews.map(({ tr, payload, screen: baseScreen }) => {
          const isSelected = selectedTemplateRegionId === tr.id;
          const screen =
            isSelected && currentRegion
              ? regionToScreen(currentRegion, videoRef.current) || baseScreen
              : baseScreen;
          if (!screen) return null;
          const isDragging =
            draggingBatchText?.videoIdx === selectedIdx && draggingBatchText.regionId === tr.id;
          const underDomFrame = textSelectionActive && isSelected;
          const batchOverlayInteractive = !underDomFrame;
          const previewText = String(payload.text ?? "").trim() || tr.label || "Texto de ejemplo";
          return (
            <TextOverlay
              key={tr.id}
              screen={screen}
              text={previewText}
              style={payload.style}
              isFocused={isSelected}
              showOutline={!underDomFrame}
              label={tr.label}
              interactive={batchOverlayInteractive}
              cursor={batchOverlayInteractive ? (isDragging ? "grabbing" : "grab") : undefined}
              zIndex={underDomFrame ? 45 : 40}
              showOverflowWarning={!textRegionGestureActive}
              onMouseDown={batchOverlayInteractive ? (e) => onBatchTextDragStart(tr, e) : undefined}
            />
          );
        })}

      {currentRegion &&
        !selectedTemplateRegionId &&
        isRegionUsable(currentRegion) &&
        (() => {
          const s = regionToScreen(currentRegion, videoRef.current);
          if (!s) return null;
          return (
            <TextOverlay
              screen={s}
              text="Texto de ejemplo"
              style={{ ...globalTextStyle, autoFit: false }}
              isFocused
              showOutline={false}
              showOverflowWarning={false}
              zIndex={35}
            />
          );
        })()}
    </>
  );
}
