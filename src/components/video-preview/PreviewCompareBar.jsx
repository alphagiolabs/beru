import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { useT } from "../../i18n/useT";

export default function PreviewCompareBar({ sidebarMode, compareMode, onSelectMode, onDismiss }) {
  const t = useT();
  return (
    <div
      className="video-preview-media-controls absolute top-2 left-1/2 -translate-x-1/2 z-[35] flex items-center gap-0.5 px-1 py-1 rounded"
      style={{ background: "rgba(0,0,0,0.82)", border: "1px solid rgba(255,255,255,0.12)" }}
    >
      {[
        ...(sidebarMode === "logo" ? [{ id: "live", label: t("logo.live") }] : []),
        { id: "css", label: sidebarMode === "logo" ? t("logo.before") : "CSS" },
        { id: "ffmpeg", label: sidebarMode === "logo" ? t("logo.after") : "FFmpeg" },
        { id: "split", label: t("logo.sideBySide") },
      ].map(({ id, label }) => (
        <Button
          key={id}
          type="button"
          variant="tertiary"
          size="sm"
          onClick={() => onSelectMode(id)}
          className="video-preview-compare-btn !h-6 !min-h-6 !rounded !px-2 !text-[9px]"
          aria-pressed={compareMode === id}
          style={{
            background: compareMode === id ? "var(--accent)" : "transparent",
            color: compareMode === id ? "var(--bg-app)" : "var(--text-secondary)",
          }}
        >
          {label}
        </Button>
      ))}
      <Button
        type="button"
        variant="tertiary"
        size="icon"
        className="video-preview-icon-btn video-preview-compare-close !ml-0.5 !h-6 !min-h-6 !w-6 !min-w-6 !p-0"
        onClick={onDismiss}
        style={{ color: "var(--text-dim)" }}
        title={t("preview.closeRenderFrame")}
        aria-label={t("preview.closeRenderFrame")}
      >
        <X size={12} />
      </Button>
    </div>
  );
}
