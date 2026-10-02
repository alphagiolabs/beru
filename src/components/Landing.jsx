import { Upload } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { importVideosFromDialog } from "../utils/import-videos";
import BrandFace from "./BrandFace";

const api = window.api;

export default function Landing() {
  const t = useT();

  const handleSelect = async () => {
    await importVideosFromDialog({ api, store: useEditorStore.getState(), t });
  };

  return (
    <div
      className="landing-surface flex-1 w-full h-full flex items-center justify-center min-h-0"
      style={{ background: "var(--bg-app)" }}
    >
      <div className="landing-content">
        <BrandFace />
        <button
          type="button"
          className="landing-drop"
          onClick={handleSelect}
          aria-label={t("landing.import")}
        >
          <span className="landing-drop-icon" aria-hidden="true">
            <Upload size={22} strokeWidth={1.75} />
          </span>
          <span className="landing-drop-title">{t("landing.title")}</span>
          <span className="landing-drop-or">{t("landing.or")}</span>
          <span className="landing-drop-cta cap-btn--primary cap-btn--size-lg">
            {t("landing.import")}
          </span>
          <span className="landing-drop-formats">{t("landing.formats")}</span>
        </button>
      </div>
    </div>
  );
}
