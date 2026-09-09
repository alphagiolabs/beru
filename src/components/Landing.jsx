import { Upload } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { importVideosFromDialog } from "../utils/import-videos";
import { Button } from "./ui/Button";

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
      <section className="landing-card" aria-labelledby="landing-title">
        <div className="landing-mark" aria-hidden="true">
          <svg viewBox="0 0 300 400" width="40" height="52">
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M0 0L140 0C260 0 260 195 140 195L165 195C295 195 295 400 165 400L0 400ZM60 50L120 50C195 50 195 145 120 145L60 145ZM60 240L140 240C225 240 225 350 140 350L60 350ZM100 168L195 195L100 222Z"
            />
          </svg>
        </div>
        <p className="landing-eyebrow">{t("landing.eyebrow")}</p>
        <h1 id="landing-title" className="landing-title">
          {t("landing.title")}
        </h1>
        <p className="landing-description">{t("landing.description")}</p>
        <div className="landing-actions">
          <Button
            type="button"
            onClick={handleSelect}
            variant="primary"
            size="lg"
            className="landing-primary-action"
            title={t("landing.import")}
          >
            <Upload size={16} /> {t("landing.import")}
          </Button>
        </div>
        <p className="landing-hint">{t("landing.shortcut")}</p>
        <p className="landing-formats">{t("landing.hint")}</p>
      </section>
    </div>
  );
}
