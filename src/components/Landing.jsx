import { Upload } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

const api = window.api;

export default function Landing() {
  const t = useT();

  const handleSelect = async () => {
    if (!api?.openVideos) {
      useEditorStore.getState().showToast({ kind: "err", text: t("errors.noApi") });
      return;
    }
    try {
      const paths = await api.openVideos();
      if (!paths?.length) return;
      await useEditorStore.getState().addVideos(paths, api);
      useEditorStore.getState().showToast({
        kind: "ok",
        text: t("drop.added", { count: paths.length }),
      });
    } catch (err) {
      console.error("[beru] Video import failed:", err);
      useEditorStore.getState().showToast({
        kind: "err",
        text: t("errors.importVideosFailed", {
          message: err?.message || t("errors.unknown"),
        }),
      });
    }
  };

  return (
    <div className="h-full flex items-center justify-center" style={{ background: "var(--bg-app)" }}>
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <svg viewBox="0 0 300 400" width="40" height="52" aria-label="Beru"><path fill="currentColor" fillRule="evenodd" d="M0 0L140 0C260 0 260 195 140 195L165 195C295 195 295 400 165 400L0 400ZM60 50L120 50C195 50 195 145 120 145L60 145ZM60 240L140 240C225 240 225 350 140 350L60 350ZM100 168L195 195L100 222Z"/></svg>
        </div>
        <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{t("landing.title")}</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {t("landing.desc")}
        </p>
        <div className="flex gap-2 mt-2">
          <button onClick={handleSelect} className="cap-btn-primary text-[12px] px-5 py-2">
            <Upload size={16} /> {t("landing.import")}
          </button>
        </div>
        <p className="text-[11px] mt-2" style={{ color: "var(--text-dim)" }}>
          {t("landing.hint")}
        </p>
      </div>
    </div>
  );
}
