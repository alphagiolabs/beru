import { useEffect } from "react";
import App from "./App";
import LoginScreen from "./components/LoginScreen";
import ErrorBoundary from "./components/ErrorBoundary";
import ConfirmDialog from "./components/ConfirmDialog";
import SettingsModal from "./components/SettingsModal";
import AppToast from "./components/AppToast";
import UpdatePrompt from "./components/UpdatePrompt";
import useUpdater from "./hooks/useUpdater";
import useEditorStore from "./stores/useEditorStore";
import { isSupabaseConfigured } from "./lib/supabaseClient";

const api = window.api;

export default function BeruRoot() {
  const authStatus = useEditorStore((s) => s.authStatus);
  const initAuth = useEditorStore((s) => s.initAuth);
  const appToast = useEditorStore((s) => s.appToast);
  const clearAppToast = useEditorStore((s) => s.clearAppToast);

  useUpdater(api);

  useEffect(() => {
    if (isSupabaseConfigured) {
      initAuth();
    }
  }, [initAuth]);

  useEffect(() => {
    if (!appToast) return undefined;
    const timer = setTimeout(() => clearAppToast(), 3500);
    return () => clearTimeout(timer);
  }, [appToast, clearAppToast]);

  const showLogin = isSupabaseConfigured && authStatus !== "authenticated";

  return (
    <ErrorBoundary>
      {showLogin ? <LoginScreen /> : <App />}
      <UpdatePrompt />
      <AppToast />
      <ConfirmDialog />
      <SettingsModal />
    </ErrorBoundary>
  );
}
