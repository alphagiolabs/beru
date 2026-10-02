import RegionBlurPreview from "./RegionBlurPreview";
import TextOverlay from "../TextOverlay";
import { isRegionUsable, regionToScreen } from "../../utils/video-utils";
import { useT } from "../../i18n/useT";

export default function LogoDraftOverlays({
  sidebarMode,
  activeTool,
  currentRegion,
  showFfmpegOverlay,
  videoRef,
  blurStrength,
  tempStart,
  tempEnd,
  textInput,
  globalTextStyle,
}) {
  const t = useT();
  if (sidebarMode !== "logo" || !currentRegion || showFfmpegOverlay) return null;

  let textDraft = null;
  if (activeTool === "text" && isRegionUsable(currentRegion)) {
    const s = regionToScreen(currentRegion, videoRef.current);
    if (s) {
      const draftText = String(textInput ?? "").trim() || t("preview.draftTextHint");
      textDraft = (
        <TextOverlay
          screen={s}
          text={draftText}
          style={{
            ...globalTextStyle,
            autoFit: false,
            textOpacity: String(textInput ?? "").trim() ? (globalTextStyle.textOpacity ?? 1) : 0.55,
          }}
          showOutline={false}
          showOverflowWarning={false}
          zIndex={35}
        />
      );
    }
  }

  return (
    <>
      {activeTool === "blur" && (
        <RegionBlurPreview
          videoRef={videoRef}
          region={currentRegion}
          blurStrength={blurStrength}
          startTime={tempStart}
          endTime={tempEnd}
          outline="2px solid rgba(0,240,234,0.8)"
        />
      )}
      {textDraft}
    </>
  );
}
