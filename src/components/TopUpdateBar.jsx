import { useEffect, useRef, useState, useCallback } from "react";
import { X, RefreshCw, AlertCircle } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

const api = typeof window !== "undefined" ? window.api : null;

const DISMISS_KEY = "beru.topUpdateBar.dismissedVersion";
const LAST_CHECK_KEY = "beru.topUpdateBar.lastCheck";
const RETRY_AFTER_MS = 30 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 2500;

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

export default function TopUpdateBar() {
  const t = useT();
  const [state, setState] = useState({ status: "idle", latest: null, error: null });
  const [dismissedVersion, setDismissedVersion] = useState(() => safeStorage.get(DISMISS_KEY));
  const updateStatus = useEditorStore((s) => s.update?.status);
  const checkForUpdates = useEditorStore((s) => s.checkForUpdates);
  const abortedRef = useRef(false);
  const autoStartedVersionRef = useRef(null);

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

  const startAutomaticUpdate = useCallback(async () => {
    if (!api?.checkForUpdates) {
      setState((s) => ({ ...s, status: "error", error: "updater-unavailable" }));
      return;
    }
    setState((s) => ({ ...s, status: "starting", error: null }));
    try {
      const res = await checkForUpdates();
      if (abortedRef.current) return;
      if (!res || res.ok !== true) {
        setState((s) => ({
          ...s,
          status: "error",
          error: res?.error || res?.reason || "updater-unavailable",
        }));
      }
    } catch (e) {
      if (abortedRef.current) return;
      setState((s) => ({ ...s, status: "error", error: e?.message || "updater-unavailable" }));
    }
  }, [checkForUpdates]);

  const latest = state.latest;
  const visible =
    (state.status === "available" || state.status === "starting") &&
    latest &&
    dismissedVersion !== latest.version;

  useEffect(() => {
    if (!visible || state.status !== "available") return;
    if (!["idle", "disabled", "not-available", "error"].includes(updateStatus || "idle")) return;
    if (autoStartedVersionRef.current === latest.version) return;
    autoStartedVersionRef.current = latest.version;
    startAutomaticUpdate();
  }, [latest?.version, startAutomaticUpdate, state.status, updateStatus, visible]);

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

  const handleUpdate = (e) => {
    e.preventDefault();
    startAutomaticUpdate();
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
        <RefreshCw size={14} className={state.status === "starting" ? "animate-spin" : ""} />
      </div>
      <span className="truncate">
        {state.status === "starting"
          ? t("topUpdateBar.starting", { version: latest.version })
          : t("topUpdateBar.message", { version: latest.version })}
      </span>
      <button
        onClick={handleUpdate}
        disabled={state.status === "starting"}
        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold flex-shrink-0 transition-opacity hover:opacity-80"
        style={{
          background: "#ffffff",
          color: "#000",
          opacity: state.status === "starting" ? 0.7 : 1,
        }}
        title={t("topUpdateBar.cta")}
      >
        <RefreshCw size={12} className={state.status === "starting" ? "animate-spin" : ""} />{" "}
        {t("topUpdateBar.cta")}
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
