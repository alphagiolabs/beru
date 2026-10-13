import { useT } from "../../i18n/useT.js";
import { Button } from "../ui/Button";
import { beruLocalUrl } from "../../utils/beru-url.js";
import { normalizeTiming } from "../../../shared/clip-timeline.js";
export default function CompositionPreview({ entry, locked, frame, videoRef, preview, clear }) {
  const t = useT(),
    item = entry?.item,
    rate = normalizeTiming(item?.timing).rate;
  return (
    <>
      {item && (
        <>
          <p className="text-[11px] text-[var(--text-secondary)]">
            {t("composition.sourcePreview")}
          </p>
          {frame ? (
            <img
              src={frame}
              className="max-h-[220px] max-w-full mx-auto"
              alt={t("composition.editedFrame")}
            />
          ) : (
            <video
              key={entry.id}
              ref={videoRef}
              src={beruLocalUrl(item.path)}
              controls
              preload="metadata"
              playsInline
              className="max-h-[220px] max-w-full mx-auto"
              onLoadedMetadata={(event) => {
                event.currentTarget.playbackRate = rate;
                event.currentTarget.preservesPitch = true;
              }}
            />
          )}
          <Button disabled={locked} onClick={frame ? clear : preview}>
            {frame ? t("composition.sourcePreview") : t("composition.previewFrame")}
          </Button>
        </>
      )}
    </>
  );
}
