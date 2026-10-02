import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/useT";
import { createExactPreview } from "./exact-preview";

export default function useFfmpegPreview({ videoRef, sel, sidebarMode }) {
  const t = useT();
  const translate = useRef(t);
  translate.current = t;
  const owner = useRef(null);
  const [preview, setPreview] = useState({
    url: null,
    loading: false,
    error: null,
    artifact: false,
    stale: false,
    compareMode: "live",
  });
  useEffect(() => {
    const current = createExactPreview({
      videoRef,
      onChange: setPreview,
      t: (...args) => translate.current(...args),
    });
    owner.current = current;
    return () => {
      current.dispose();
      owner.current = null;
    };
  }, [videoRef, sel?.path]);

  const visible = !!preview.url;
  return {
    ffmpegPreviewUrl: preview.url,
    ffmpegPreviewLoading: preview.loading,
    ffmpegPreviewError: preview.error,
    ffmpegPreviewArtifact: preview.artifact,
    ffmpegPreviewStale: preview.stale,
    showFfmpegPreview: visible,
    previewCompareMode: preview.compareMode,
    isSplitCompare: visible && preview.compareMode === "split",
    showFfmpegOverlay: visible && preview.compareMode === "ffmpeg",
    logoComparisonVisible: sidebarMode === "logo" && visible && preview.compareMode !== "live",
    setPreviewCompareMode: (mode) => owner.current?.selectComparison(mode),
    beginLogoGesture: () => owner.current?.beginGesture(),
    toggleRenderFrame: () => owner.current?.toggle(),
    dismissFfmpegPreview: () => owner.current?.dismiss(),
  };
}
