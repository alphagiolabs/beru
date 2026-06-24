import { useState } from "react";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { isSupabaseConfigured } from "../lib/supabaseClient";

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
    <div className="login-screen">
      <div className="login-screen-bg" aria-hidden="true">
        <div className="login-screen-glow login-screen-glow--1" />
        <div className="login-screen-glow login-screen-glow--2" />
        <div className="login-screen-grid" />
      </div>

      <div
        className="cap-titlebar-drag flex-shrink-0"
        style={{ height: "env(titlebar-area-height, 0px)" }}
      />

      <div className="login-screen-body">
        <div className="login-screen-card">
          <div className="login-screen-brand">
            <div className="login-screen-logo">
              <svg viewBox="0 0 300 400" width="36" height="48" aria-hidden="true">
                <path
                  fill="currentColor"
                  fillRule="evenodd"
                  d="M0 0L140 0C260 0 260 195 140 195L165 195C295 195 295 400 165 400L0 400ZM60 50L120 50C195 50 195 145 120 145L60 145ZM60 240L140 240C225 240 225 350 140 350L60 350ZM100 168L195 195L100 222Z"
                />
              </svg>
            </div>
            <div>
              <h1 className="login-screen-title">{t("auth.title")}</h1>
              <p className="login-screen-subtitle">{t("auth.subtitle")}</p>
            </div>
          </div>

          {!isSupabaseConfigured ? (
            <div className="login-screen-alert login-screen-alert--warn">
              <p>{t("auth.notConfigured")}</p>
              <p className="login-screen-hint">{t("auth.notConfiguredHint")}</p>
            </div>
          ) : loading ? (
            <div className="login-screen-loading">
              <Loader2 size={28} className="login-screen-spin" />
              <span>{t("auth.checkingSession")}</span>
            </div>
          ) : (
            <form className="login-screen-form" onSubmit={handleSubmit} noValidate>
              {displayError && (
                <div className="login-screen-alert login-screen-alert--error" role="alert">
                  {displayError}
                </div>
              )}

              <label className="login-screen-field">
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

              <label className="login-screen-field">
                <span>{t("auth.password")}</span>
                <div className="login-screen-password-wrap">
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
                    className="login-screen-password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <button type="submit" className="login-screen-submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 size={16} className="login-screen-spin" />
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

        <p className="login-screen-footer">{t("auth.footer")}</p>
      </div>
    </div>
  );
}
