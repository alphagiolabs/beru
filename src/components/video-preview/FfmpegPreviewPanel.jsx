import { X } from "lucide-react";

const COMPARE_MODES = [
  { id: "css", label: "CSS" },
  { id: "ffmpeg", label: "FFmpeg" },
  { id: "split", label: "Lado a lado" },
];

export function FfmpegOverlay({ visible, url }) {
  if (!visible || !url) return null;
  return (
    <div className="absolute inset-0 z-[25]">
      <img
        src={url}
        alt="Preview FFmpeg renderizado"
        className="w-full h-full object-contain rounded pointer-events-none"
        draggable={false}
      />
    </div>
  );
}

export function FfmpegSplitPane({ visible, url }) {
  if (!visible || !url) return null;
  return (
    <div className="relative flex-1 min-w-0 flex items-center justify-center rounded overflow-hidden">
      <img
        src={url}
        alt="Preview FFmpeg renderizado"
        className="max-h-[calc(100vh-200px)] max-w-full object-contain rounded"
        draggable={false}
      />
      <div
        className="absolute top-2 left-2 px-2 py-1 rounded text-[9px] font-medium pointer-events-none"
        style={{ background: "var(--overlay)", color: "var(--accent)" }}
      >
        FFmpeg (drawtext)
      </div>
    </div>
  );
}

export function FfmpegCompareToolbar({ visible, url, mode, onModeChange, onDismiss }) {
  if (!visible || !url) return null;
  return (
    <div
      className="absolute top-2 left-1/2 -translate-x-1/2 z-[35] flex items-center gap-0.5 px-1 py-1 rounded"
      style={{ background: "rgba(0,0,0,0.82)", border: "1px solid rgba(255,255,255,0.12)" }}
    >
      {COMPARE_MODES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onModeChange(id)}
          className="px-2 py-0.5 rounded text-[9px] font-medium transition-colors"
          style={{
            background: mode === id ? "var(--accent)" : "transparent",
            color: mode === id ? "var(--bg-app)" : "var(--text-secondary)",
          }}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        onClick={onDismiss}
        className="p-0.5 ml-0.5 rounded hover:bg-white/10"
        style={{ color: "var(--text-dim)" }}
        title="Cerrar comparación"
      >
        <X size={12} />
      </button>
    </div>
  );
}
