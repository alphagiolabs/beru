import { useT } from "../../i18n/useT";

export default function VideoErrorOverlay({ videoError, ffmpegPreviewError, sidebarMode }) {
  const t = useT();
  return (
    <>
      {videoError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div
            className="pointer-events-auto max-w-[80%] rounded px-3 py-2 text-[11px] font-medium"
            style={{
              background: "var(--rose)",
              color: "var(--text-on-rose)",
            }}
          >
            {t("preview.videoLoadError", { error: videoError })}
          </div>
        </div>
      )}
      {ffmpegPreviewError && sidebarMode === "logo" && (
        <div
          role="alert"
          className="absolute left-2 right-2 bottom-10 z-[36] rounded bg-red-950/95 px-3 py-2 text-xs text-white"
        >
          {t("logo.previewError")}: {ffmpegPreviewError.slice(0, 280)}
        </div>
      )}
    </>
  );
}
