import { useEffect, useState } from "react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { VIDEO_EXT } from "../../shared/video-extensions.js";

export default function DragOverlay() {
  const isDragging = useEditorStore((s) => s.isDragging);
  const t = useT();
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!isDragging) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const handler = (e) => {
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files || []);
      const paths = files.map((f) => f.path).filter(Boolean);
      const videoCount = files.filter((f) => VIDEO_EXT.test(f.name)).length;
      const otherCount = paths.length - videoCount;
      if (cancelled) return;
      setPreview({
        total: files.length,
        videos: videoCount,
        others: Math.max(0, otherCount),
      });
    };
    window.addEventListener("dragover", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("dragover", handler);
    };
  }, [isDragging]);

  if (!isDragging) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
      style={{ background: "rgba(0,240,234,0.08)", border: "3px dashed rgba(0,240,234,0.4)" }}
    >
      <div
        className="flex flex-col items-center gap-3 px-8 py-6 rounded-xl"
        style={{ background: "rgba(0,0,0,0.85)" }}
      >
        <svg className="w-10 h-10" fill="none" stroke="var(--accent)" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
          {t("drop.overlay")}
        </span>
        {preview && preview.total > 0 && (
          <span className="text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
            {preview.videos > 0 ? t("drop.overlayDetected", { count: preview.videos }) : "—"}
            {preview.others > 0 && ` · ${t("drop.overlayOthers", { count: preview.others })}`}
          </span>
        )}
        <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
          {t("drop.overlayHint")}
        </span>
      </div>
    </div>
  );
}
