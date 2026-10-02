import { useT } from "../../i18n/useT";

export default function FfmpegOverlay({ url, stale, artifact }) {
  const t = useT();
  return (
    <div className="absolute inset-0 z-[40] bg-black pointer-events-none">
      <img
        src={url}
        alt={t("preview.ffmpegAlt")}
        className="w-full h-full object-contain rounded pointer-events-none"
        style={{ opacity: stale ? 0.55 : 1 }}
        draggable={false}
      />
      <div
        className="absolute top-2 right-2 px-2 py-1 rounded text-[9px] font-medium pointer-events-none"
        style={{ background: "rgba(0,0,0,0.82)", color: "#ffffff" }}
      >
        {artifact ? t("preview.sourceArtifact") : t("preview.sourceFfmpeg")}
      </div>
    </div>
  );
}
