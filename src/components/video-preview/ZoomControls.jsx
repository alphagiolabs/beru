import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../ui/Button";
import { useT } from "../../i18n/useT";
import { MIN_ZOOM, MAX_ZOOM } from "./utils";

export default function ZoomControls({ zoom, zoomIn, zoomOut, zoomReset }) {
  const t = useT();
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-white/10 shadow-sm backdrop-blur-md transition-all"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
    >
      <Button
        type="button"
        variant="tertiary"
        size="icon"
        className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
        onClick={zoomOut}
        disabled={zoom <= MIN_ZOOM}
        style={{ color: "var(--text-secondary, #a3a3a3)" }}
        title={t("preview.zoomOut")}
        aria-label={t("preview.zoomOut")}
      >
        <ZoomOut size={14} />
      </Button>

      <div className="w-[1px] h-3 bg-white/10 mx-0.5"></div>

      <Button
        type="button"
        variant="tertiary"
        size="sm"
        onClick={zoomReset}
        className="video-preview-zoom-reset !h-7 !min-h-7 !min-w-[48px] !px-2 !py-0.5 !text-[10px] !font-mono !font-medium"
        style={{ color: zoom > 1 ? "var(--text-accent)" : "var(--text-secondary, #a3a3a3)" }}
        title={t("preview.zoomReset")}
        aria-label={t("preview.zoomReset")}
      >
        {Math.round(zoom * 100)}%
      </Button>

      <div className="w-[1px] h-3 bg-white/10 mx-0.5"></div>

      <Button
        type="button"
        variant="tertiary"
        size="icon"
        className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
        onClick={zoomIn}
        disabled={zoom >= MAX_ZOOM}
        style={{ color: "var(--text-secondary, #a3a3a3)" }}
        title={t("preview.zoomIn")}
        aria-label={t("preview.zoomIn")}
      >
        <ZoomIn size={14} />
      </Button>
    </div>
  );
}
