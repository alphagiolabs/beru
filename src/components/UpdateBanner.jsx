import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Minus,
  RefreshCw,
  X,
} from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

const api = typeof window !== "undefined" ? window.api : null;

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UpdateBanner() {
  const update = useEditorStore((s) => s.update);
  const t = useT();
  const getState = useEditorStore.getState;

  if (
    !update ||
    update.status === "idle" ||
    update.status === "disabled" ||
    update.status === "not-available"
  )
    return null;

  const status = update.status;
  const percent = clampPercent(update.percent);
  const version = update.version || "?";

  if (status === "downloading") {
    const transferred = formatBytes(update.transferred);
    const total = formatBytes(update.total);
    const progressLabel =
      transferred && total
        ? t("updater.downloadSize", { transferred, total })
        : t("updater.downloadPercent", { percent: Math.round(percent) });

    const openReleaseNotes = () => {
      if (!update.releaseUrl) return;
      if (api?.openExternal) {
        api.openExternal(update.releaseUrl);
      } else if (typeof window !== "undefined") {
        window.open(update.releaseUrl, "_blank", "noopener,noreferrer");
      }
    };

    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-0 z-[90] pointer-events-none"
        style={{ background: "rgba(0,0,0,0.18)" }}
      >
        <section
          aria-labelledby="update-download-title"
          className="pointer-events-auto absolute left-4 top-4 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-lg shadow-2xl"
          style={{
            background: "#151515",
            border: "1px solid #272727",
            boxShadow: "0 22px 60px rgba(0,0,0,0.42)",
            color: "#f4f4f5",
          }}
        >
          <div className="px-4 pb-4 pt-4">
            <div className="flex items-start justify-between gap-4">
              <h2 id="update-download-title" className="text-[15px] font-semibold leading-5">
                {t("updater.downloadTitle")}
              </h2>
              <button
                type="button"
                onClick={() => getState().dismissUpdateBanner()}
                className="mt-0.5 rounded p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/30"
                title={t("updater.minimize")}
                aria-label={t("updater.minimize")}
              >
                <Minus size={15} />
              </button>
            </div>

            <p className="mt-5 text-[14px] leading-5 text-zinc-400">
              {t("updater.downloadBody", { version })}
            </p>

            {update.releaseUrl && (
              <button
                type="button"
                onClick={openReleaseNotes}
                className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-zinc-300 underline decoration-zinc-500 underline-offset-4 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-white/25"
              >
                {t("updater.releaseNotes")}
                <ExternalLink size={11} />
              </button>
            )}

            <div
              className="mt-5 h-1.5 overflow-hidden rounded-sm"
              style={{ background: "rgba(255,255,255,0.18)" }}
              aria-label={t("updater.downloadProgress", { percent: Math.round(percent) })}
            >
              <div
                className="h-full rounded-sm transition-[width] duration-300"
                style={{
                  width: `${percent}%`,
                  background: "linear-gradient(90deg, #d9d9d9, #8ee7d8)",
                }}
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-zinc-500">
              <span>{progressLabel}</span>
              <span className="font-mono tabular-nums text-zinc-300">{Math.round(percent)}%</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const variant = status === "error" ? "rose" : status === "ready" ? "green" : "blue";

  const styles = {
    blue: { bg: "rgba(0,180,176,0.12)", border: "#00b4b0", fg: "#00b4b0" },
    green: { bg: "rgba(34,197,94,0.10)", border: "#22c55e", fg: "#22c55e" },
    rose: { bg: "rgba(244,63,94,0.10)", border: "#f43f5e", fg: "#f43f5e" },
  }[variant];

  const Icon = status === "ready" ? CheckCircle2 : status === "error" ? AlertTriangle : RefreshCw;

  let text = "";
  if (status === "checking") text = t("updater.checking");
  else if (status === "available")
    text = t("updater.available", { version: update.version || "?" });
  else if (status === "downloading")
    text = t("updater.downloading", { percent: Math.round(update.percent || 0) });
  else if (status === "ready") text = t("updater.ready", { version: update.version || "?" });
  else if (status === "error") text = t("updater.error", { message: update.error || "?" });

  return (
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-md px-3 py-2 shadow-lg"
      style={{
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        color: styles.fg,
        minWidth: 360,
        maxWidth: 560,
      }}
    >
      <Icon
        size={14}
        className={status === "checking" || status === "downloading" ? "animate-spin" : ""}
      />
      <div className="flex-1 text-[12px] font-medium truncate">{text}</div>

      {status === "available" && (
        <span className="text-[11px] opacity-70">{t("updater.downloading")}</span>
      )}
      {status === "ready" && (
        <button
          onClick={() => getState().installUpdate()}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold"
          style={{ background: styles.fg, color: "#000" }}
        >
          <RefreshCw size={12} /> {t("updater.install")}
        </button>
      )}
      {status !== "downloading" && (
        <button
          onClick={() => getState().dismissUpdateBanner()}
          className="p-0.5 rounded hover:bg-white/10"
          title={t("updater.dismiss")}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
