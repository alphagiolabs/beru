import { RefreshCw, Sparkles, X } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

const DISMISS_KEY = "beru.updateReady.dismissedVersion";

const safeStorage = {
  get(k) {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(k) : null;
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(k, v);
    } catch {}
  },
};

export default function UpdateReadyModal() {
  const t = useT();
  const update = useEditorStore((s) => s.update);
  const installUpdate = useEditorStore((s) => s.installUpdate);

  const visible =
    update &&
    update.status === "ready" &&
    update.version &&
    safeStorage.get(DISMISS_KEY) !== update.version;

  if (!visible) return null;

  const handleInstall = () => {
    installUpdate();
  };

  const handleLater = () => {
    safeStorage.set(DISMISS_KEY, update.version);
    useEditorStore.setState((s) => ({
      update: { ...s.update, status: "idle" },
    }));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-ready-title"
      className="cap-modal-overlay"
      style={{ zIndex: 80 }}
    >
      <div className="cap-modal-panel max-w-md relative">
        <button
          onClick={handleLater}
          className="absolute top-3 right-3 p-1 rounded hover:opacity-80 transition-opacity"
          style={{ color: "var(--text-dim)" }}
          title={t("updater.modal.later")}
          aria-label={t("updater.modal.later")}
        >
          <X size={16} />
        </button>

        <div className="cap-modal-header pr-10">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: "color-mix(in srgb, var(--accent-brand) 18%, transparent)",
              color: "var(--accent-brand)",
            }}
          >
            <Sparkles size={20} />
          </div>
          <h2
            id="update-ready-title"
            className="text-base font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t("updater.modal.title")}
          </h2>
        </div>

        <p className="cap-modal-body">{t("updater.modal.body", { version: update.version })}</p>

        <div
          className="mx-5 mb-3 px-3 py-2 rounded text-[11px]"
          style={{
            background: "color-mix(in srgb, var(--rose) 10%, transparent)",
            color: "var(--rose)",
            border: "1px solid color-mix(in srgb, var(--rose) 28%, transparent)",
          }}
        >
          {t("updater.modal.note")}
        </div>

        <div className="cap-modal-footer">
          <button onClick={handleLater} className="cap-btn-secondary !text-[12px] !px-4 !py-2">
            {t("updater.modal.later")}
          </button>
          <button
            onClick={handleInstall}
            autoFocus
            className="cap-btn-primary !text-[12px] !px-4 !py-2"
          >
            <RefreshCw size={13} />
            {t("updater.modal.install")}
          </button>
        </div>
      </div>
    </div>
  );
}
