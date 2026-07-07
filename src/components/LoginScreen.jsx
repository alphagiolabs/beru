import { useState } from "react";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { isSupabaseConfigured } from "../lib/supabaseClient";

const VIDEO_URL = "https://res.cloudinary.com/dzhp64paw/video/upload/v1782516787/login.mp4";

function BeruLogo({ className = "h-8 md:h-10" }) {
  return (
    <svg viewBox="0 0 300 400" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M0 0L140 0C260 0 260 195 140 195L165 195C295 195 295 400 165 400L0 400ZM60 50L120 50C195 50 195 145 120 145L60 145ZM60 240L140 240C225 240 225 350 140 350L60 350ZM100 168L195 195L100 222Z"
      />
    </svg>
  );
}

export default function LoginScreen() {
  const t = useT();
  const authStatus = useEditorStore((s) => s.authStatus);
  const authError = useEditorStore((s) => s.authError);
  const signIn = useEditorStore((s) => s.signIn);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const loading = authStatus === "loading";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");

    if (!email.trim() || !password) {
      setLocalError(t("auth.fillFields"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await signIn(email, password);
      if (!res.ok) {
        const key = res.error?.startsWith("auth.") ? res.error : null;
        setLocalError(key ? t(key) : res.error || t("auth.loginFailed"));
      }
    } catch {
      setLocalError(t("auth.loginFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || (authError ? t(authError) : "");

  return (
    <div className="login-cinematic relative flex flex-col h-full overflow-hidden bg-black text-white">
      <video
        className="login-cinematic-video"
        src={VIDEO_URL}
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      />

      <div className="login-cinematic-blur-overlay" aria-hidden="true" />

      <div
        className="cap-titlebar-drag flex-shrink-0 relative z-50"
        style={{ height: "env(titlebar-area-height, 0px)" }}
      />

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 md:px-12 py-6 min-h-0 overflow-hidden">
        <div className="w-full max-w-[420px] flex flex-col items-center">
          <div
            className="animate-blur-fade-up flex items-center gap-3 mb-6"
            style={{ animationDelay: "300ms" }}
          >
            <BeruLogo className="h-10 md:h-12 w-auto text-white" />
            <span className="text-2xl md:text-3xl font-semibold tracking-tight">BERU</span>
          </div>

          <div
            className="login-cinematic-form-card liquid-glass animate-blur-fade-up w-full"
            style={{ animationDelay: "400ms" }}
          >
            <p className="text-center text-sm text-gray-400 mb-5 m-0">{t("auth.subtitle")}</p>

            {!isSupabaseConfigured ? (
              <div className="login-cinematic-alert login-cinematic-alert--warn">
                <p>{t("auth.notConfigured")}</p>
                <p className="login-cinematic-hint">{t("auth.notConfiguredHint")}</p>
              </div>
            ) : loading ? (
              <div className="login-cinematic-loading">
                <Loader2 size={28} className="login-cinematic-spin" />
                <span>{t("auth.checkingSession")}</span>
              </div>
            ) : (
              <form className="login-cinematic-form" onSubmit={handleSubmit} noValidate>
                {displayError && (
                  <div className="login-cinematic-alert login-cinematic-alert--error" role="alert">
                    {displayError}
                  </div>
                )}

                <label className="login-cinematic-field">
                  <span>{t("auth.email")}</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@empresa.com"
                    autoComplete="email"
                    disabled={submitting}
                    required
                  />
                </label>

                <label className="login-cinematic-field">
                  <span>{t("auth.password")}</span>
                  <div className="login-cinematic-password-wrap">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      disabled={submitting}
                      required
                    />
                    <button
                      type="button"
                      className="login-cinematic-password-toggle"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>

                <button type="submit" className="login-cinematic-submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="login-cinematic-spin" />
                      {t("auth.signingIn")}
                    </>
                  ) : (
                    <>
                      <LogIn size={16} />
                      {t("auth.signIn")}
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
