import { useEffect } from "react";
import App from "./App";
import LoginScreen from "./components/LoginScreen";
import ErrorBoundary from "./components/ErrorBoundary";
import ConfirmDialog from "./components/ConfirmDialog";
import SettingsModal from "./components/SettingsModal";
import AppToast from "./components/AppToast";
import useEditorStore from "./stores/useEditorStore";
import { isSupabaseConfigured } from "./lib/supabaseClient";

export default function BeruRoot() {
  const authStatus = useEditorStore((s) => s.authStatus);
  const initAuth = useEditorStore((s) => s.initAuth);
  const appToast = useEditorStore((s) => s.appToast);
  const clearAppToast = useEditorStore((s) => s.clearAppToast);

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
      <AppToast />
      <ConfirmDialog />
      <SettingsModal />
    </ErrorBoundary>
  );
}
