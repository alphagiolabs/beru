import RegionBlurPreview from "./RegionBlurPreview";
import TextOverlay from "../TextOverlay";
import DateTimeOverlay from "./DateTimeOverlay";
import { sourceRegionToOutput, stampPlacement } from "../../utils/stamp-geometry";
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
  tempClock,
  stampGeometry,
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

  if (activeTool === "datetime" && isRegionUsable(currentRegion)) {
    const region = stampGeometry
      ? sourceRegionToOutput(currentRegion, stampGeometry)
      : currentRegion;
    const placement = stampPlacement(region, stampGeometry, videoRef.current);
    if (placement) {
      textDraft = (
        <DateTimeOverlay
          videoRef={videoRef}
          screen={placement.screen}
          cssTransform={placement.cssTransform}
          op={{ ...globalTextStyle, ...tempClock }}
          fallbackText={t("datetime.draftHint")}
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
