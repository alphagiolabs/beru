import { useT } from "../../i18n/useT";

export default function SplitComparePane({ url, videoMaxH, sidebarMode, artifact }) {
  const t = useT();
  return (
    <div className="relative flex-1 min-w-0 flex items-center justify-center rounded overflow-hidden">
      <img
        src={url}
        alt={t("preview.ffmpegAlt")}
        className={`${videoMaxH} max-w-full object-contain rounded`}
        draggable={false}
      />
      <div
        className="absolute top-2 left-2 px-2 py-1 rounded text-[9px] font-medium pointer-events-none"
        style={{ background: "rgba(0,0,0,0.82)", color: "#ffffff" }}
      >
        {sidebarMode === "logo"
          ? t("logo.after")
          : artifact
            ? t("preview.sourceArtifact")
            : t("preview.sourceFfmpeg")}
      </div>
    </div>
  );
}
