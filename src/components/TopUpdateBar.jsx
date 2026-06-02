import { useEffect, useRef, useState, useCallback } from "react";
import { Download, X, RefreshCw, AlertCircle } from "lucide-react";
import { useT } from "../i18n/useT";

const api = typeof window !== "undefined" ? window.api : null;

const DISMISS_KEY = "beru.topUpdateBar.dismissedVersion";
const LAST_CHECK_KEY = "beru.topUpdateBar.lastCheck";
const RETRY_AFTER_MS = 30 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 2500;

const safeStorage = {
  get(k) {
    try { return typeof localStorage !== "undefined" ? localStorage.getItem(k) : null; }
    catch { return null; }
  },
  set(k, v) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(k, v); } catch {}
  },
};

export default function TopUpdateBar() {
  const t = useT();
  const [state, setState] = useState({ status: "idle", latest: null, error: null });
  const [dismissedVersion, setDismissedVersion] = useState(() => safeStorage.get(DISMISS_KEY));
  const abortedRef = useRef(false);

  const fetchLatest = useCallback(async () => {
    if (!api?.checkGitHubRelease) {
      return;
    }
    if (abortedRef.current) return;
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      const res = await api.checkGitHubRelease();
      if (abortedRef.current) return;
      if (!res || res.ok !== true) {
        setState({ status: "error", latest: null, error: res?.error || "ipc-error" });
        return;
      }
      if (res.updateAvailable && res.latest) {
        setState({ status: "available", latest: res.latest, error: null });
      } else {
        setState({ status: "up-to-date", latest: null, error: null });
      }
      safeStorage.set(LAST_CHECK_KEY, String(Date.now()));
    } catch (e) {
      if (abortedRef.current) return;
      setState({ status: "error", latest: null, error: e?.message || "network" });
    }
  }, []);

  useEffect(() => {
    const last = Number(safeStorage.get(LAST_CHECK_KEY) || 0);
    const fresh = last && Date.now() - last < RETRY_AFTER_MS;
    let timerId = null;
    if (fresh) {
      fetchLatest();
    } else {
      timerId = setTimeout(fetchLatest, FIRST_CHECK_DELAY_MS);
    }
    return () => {
      abortedRef.current = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [fetchLatest]);

  const latest = state.latest;
  const visible =
    state.status === "available" &&
    latest &&
    dismissedVersion !== latest.version;

  if (state.status === "idle" || state.status === "loading" || state.status === "up-to-date") {
    return null;
  }

  if (state.status === "error") {
    return (
      <div
        role="status"
        className="fixed top-0 left-0 right-0 z-[70] flex items-center justify-center gap-2 px-3 py-1.5 text-[12px] font-medium"
        style={{ background: "#1a0a0a", color: "#fca5a5", borderBottom: "1px solid #3a0a0a" }}
      >
        <AlertCircle size={14} />
        <span className="truncate">{t("topUpdateBar.error", { message: state.error || "?" })}</span>
        <button
          onClick={fetchLatest}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold hover:opacity-80"
          style={{ background: "#ffffff", color: "#000" }}
        >
          <RefreshCw size={11} /> {t("topUpdateBar.retry")}
        </button>
        <button
          onClick={() => setState((s) => ({ ...s, status: "idle" }))}
          className="p-0.5 rounded hover:bg-white/10"
          title={t("topUpdateBar.dismiss")}
          aria-label={t("topUpdateBar.dismiss")}
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  if (!visible) return null;

  const downloadUrl = latest.installerUrl || latest.htmlUrl;
  const downloadIsDirect = !!latest.installerUrl;

  const handleDownload = (e) => {
    e.preventDefault();
    if (api?.openExternal) {
      api.openExternal(downloadUrl);
    } else if (typeof window !== "undefined") {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleDismiss = () => {
    safeStorage.set(DISMISS_KEY, latest.version);
    setDismissedVersion(latest.version);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[70] flex items-center justify-center gap-3 px-3 py-1.5 text-[12px] font-medium"
      style={{
        background: "#0a0a0a",
        color: "#ffffff",
        borderBottom: "1px solid #222",
      }}
    >
      <div
        className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
        style={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }}
        aria-hidden="true"
      >
        <Download size={14} className="text-white" />
      </div>
      <span className="truncate">
        {t("topUpdateBar.message", { version: latest.version })}
      </span>
      <button
        onClick={handleDownload}
        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold flex-shrink-0 transition-opacity hover:opacity-80"
        style={{ background: "#ffffff", color: "#000" }}
        title={downloadIsDirect ? t("topUpdateBar.ctaDirect") : t("topUpdateBar.cta")}
      >
        <Download size={12} /> {t("topUpdateBar.cta")}
      </button>
      <button
        onClick={handleDismiss}
        className="p-0.5 rounded hover:bg-white/10 flex-shrink-0"
        title={t("topUpdateBar.dismiss")}
        aria-label={t("topUpdateBar.dismiss")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
