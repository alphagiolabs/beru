import { useEffect, Suspense } from "react";
import { Loader2 } from "lucide-react";
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
import { useT } from "./i18n/useT";
import { DesktopPet, PetPaletteModal, usePetKeyboard } from "./features/pets";

const api = window.api;

/** Neutral boot screen while the persisted session is restored — not the login UI. */
function AuthSessionLoading() {
  const t = useT();
  return (
    <div
      className="h-screen flex flex-col items-center justify-center gap-3"
      style={{ background: "var(--bg-app)", color: "var(--text-secondary)" }}
      role="status"
      aria-live="polite"
      data-testid="auth-session-loading"
    >
      <Loader2 size={28} className="login-cinematic-spin" aria-hidden="true" />
      <span>{t("auth.checkingSession")}</span>
    </div>
  );
}

function AuthGate() {
  const authStatus = useEditorStore((s) => s.authStatus);

  if (!isSupabaseConfigured) return <App />;
  if (authStatus === "loading") return <AuthSessionLoading />;
  if (authStatus === "authenticated") return <App />;
  return <LoginScreen />;
}

export default function BeruRoot() {
  const initAuth = useEditorStore((s) => s.initAuth);
  const appToast = useEditorStore((s) => s.appToast);
  const clearAppToast = useEditorStore((s) => s.clearAppToast);

  useUpdater(api);
  usePetKeyboard();

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

  return (
    <ErrorBoundary>
      <AuthGate />
      <UpdatePrompt />
      <AppToast />
      <ConfirmDialog />
      <SettingsModal />
      <Suspense fallback={null}>
        <DesktopPet />
        <PetPaletteModal />
      </Suspense>
    </ErrorBoundary>
  );
}
