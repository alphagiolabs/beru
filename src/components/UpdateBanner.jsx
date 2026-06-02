import { Download, RefreshCw, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

export default function UpdateBanner() {
  const store = useEditorStore();
  const t = useT();
  const { update } = store;

  if (!update || update.status === "idle" || update.status === "disabled" || update.status === "not-available") return null;

  const status = update.status;
  const variant =
    status === "error" ? "rose"
    : status === "ready" ? "green"
    : "blue";

  const styles = {
    blue:  { bg: "rgba(0,180,176,0.12)", border: "#00b4b0", fg: "#00b4b0" },
    green: { bg: "rgba(34,197,94,0.10)",  border: "#22c55e", fg: "#22c55e" },
    rose:  { bg: "rgba(244,63,94,0.10)",  border: "#f43f5e", fg: "#f43f5e" },
  }[variant];

  const Icon = status === "ready" ? CheckCircle2 : status === "error" ? AlertTriangle : RefreshCw;

  let text = "";
  if (status === "checking") text = t("updater.checking");
  else if (status === "available") text = t("updater.available", { version: update.version || "?" });
  else if (status === "downloading") text = t("updater.downloading", { percent: Math.round(update.percent || 0) });
  else if (status === "ready") text = t("updater.ready", { version: update.version || "?" });
  else if (status === "error") text = t("updater.error", { message: update.error || "?" });

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-md px-3 py-2 shadow-lg"
      style={{ background: styles.bg, border: `1px solid ${styles.border}`, color: styles.fg, minWidth: 360, maxWidth: 560 }}>
      <Icon size={14} className={status === "checking" || status === "downloading" ? "animate-spin" : ""} />
      <div className="flex-1 text-[12px] font-medium truncate">{text}</div>

      {status === "available" && (
        <button onClick={() => store.downloadUpdate()}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold"
          style={{ background: styles.fg, color: "#000" }}>
          <Download size={12} /> {t("updater.download")}
        </button>
      )}
      {status === "ready" && (
        <button onClick={() => store.installUpdate()}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold"
          style={{ background: styles.fg, color: "#000" }}>
          <RefreshCw size={12} /> {t("updater.install")}
        </button>
      )}
      {status !== "downloading" && (
        <button onClick={() => store.dismissUpdateBanner()} className="p-0.5 rounded hover:bg-white/10" title={t("updater.dismiss")}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}
