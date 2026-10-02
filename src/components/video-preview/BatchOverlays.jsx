import TextOverlay from "../TextOverlay";
import { isRegionUsable, regionToScreen } from "../../utils/video-utils";
import { useT } from "../../i18n/useT";

export default function BatchOverlays({
  sidebarMode,
  selectedIdx,
  currentRegion,
  showFfmpegOverlay,
  showFfmpegPreview,
  videoRef,
  globalTextStyle,
  batchRegionPreviews,
  selectedTemplateRegionId,
  draggingBatchText,
  textSelectionActive,
  textGestureActive,
  onBatchTextDragStart,
}) {
  const t = useT();
  if (sidebarMode !== "batch" || showFfmpegOverlay) return null;

  let unboundDraft = null;
  if (currentRegion && !selectedTemplateRegionId && isRegionUsable(currentRegion)) {
    const s = regionToScreen(currentRegion, videoRef.current);
    if (s) {
      unboundDraft = (
        <TextOverlay
          screen={s}
          text={t("preview.sampleText")}
          style={{ ...globalTextStyle, autoFit: false }}
          isFocused
          showOutline={false}
          showOverflowWarning={false}
          zIndex={35}
        />
      );
    }
  }

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
          const previewText =
            String(payload.text ?? "").trim() || tr.label || t("preview.sampleText");
          return (
            <TextOverlay
              key={tr.id}
              screen={screen}
              text={previewText}
              style={payload.style}
              isFocused={isSelected}
              showOutline={!showFfmpegPreview && !underDomFrame}
              label={tr.label}
              interactive={batchOverlayInteractive}
              cursor={batchOverlayInteractive ? (isDragging ? "grabbing" : "grab") : undefined}
              zIndex={underDomFrame ? 45 : 40}
              showOverflowWarning={!showFfmpegPreview && !textGestureActive}
              onMouseDown={batchOverlayInteractive ? (e) => onBatchTextDragStart(tr, e) : undefined}
            />
          );
        })}
      {unboundDraft}
    </>
  );
}
