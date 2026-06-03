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
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
    >
      <div
        className="relative w-full max-w-md rounded-lg shadow-2xl overflow-hidden"
        style={{
          background: "#141414",
          border: "1px solid #2a2a2a",
        }}
      >
        <button
          onClick={handleLater}
          className="absolute top-3 right-3 p-1 rounded hover:bg-white/10"
          title={t("updater.modal.later")}
          aria-label={t("updater.modal.later")}
        >
          <X size={16} style={{ color: "#999" }} />
        </button>

        <div className="px-6 pt-6 pb-2 flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,180,176,0.15)", color: "#00b4b0" }}
          >
            <Sparkles size={20} />
          </div>
          <h2 id="update-ready-title" className="text-base font-semibold" style={{ color: "#fff" }}>
            {t("updater.modal.title")}
          </h2>
        </div>

        <div className="px-6 pb-2">
          <p className="text-[13px] leading-relaxed" style={{ color: "#d0d0d0" }}>
            {t("updater.modal.body", { version: update.version })}
          </p>
        </div>

        <div
          className="mx-6 my-3 px-3 py-2 rounded text-[11px]"
          style={{
            background: "rgba(244,63,94,0.08)",
            color: "#fda4af",
            border: "1px solid rgba(244,63,94,0.2)",
          }}
        >
          {t("updater.modal.note")}
        </div>

        <div className="px-6 pb-6 flex items-center justify-end gap-2">
          <button
            onClick={handleLater}
            className="px-3 py-2 rounded text-[12px] font-medium hover:bg-white/5"
            style={{ color: "#999" }}
          >
            {t("updater.modal.later")}
          </button>
          <button
            onClick={handleInstall}
            autoFocus
            className="flex items-center gap-2 px-4 py-2 rounded text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: "#00b4b0", color: "#000" }}
          >
            <RefreshCw size={13} />
            {t("updater.modal.install")}
          </button>
        </div>
      </div>
    </div>
  );
}
