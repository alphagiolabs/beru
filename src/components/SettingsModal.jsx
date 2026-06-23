import { useMemo } from "react";
import { X, Settings, Palette, Users } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import UserManagementPanel from "./settings/UserManagementPanel";
import AppearancePanel from "./settings/AppearancePanel";

function accountInitial(email) {
  const ch = email?.trim()?.[0];
  return ch ? ch.toUpperCase() : "?";
}

export default function SettingsModal() {
  const showSettings = useEditorStore((s) => s.showSettings);
  const setShowSettings = useEditorStore((s) => s.setShowSettings);
  const settingsTab = useEditorStore((s) => s.settingsTab);
  const setSettingsTab = useEditorStore((s) => s.setSettingsTab);
  const profile = useEditorStore((s) => s.profile);
  const t = useT();

  const isAdmin = profile?.role === "admin";

  const subtitle = useMemo(() => {
    if (settingsTab === "users") return t("settings.subtitleUsers");
    return t("settings.subtitleAppearance");
  }, [settingsTab, t]);

  if (!showSettings) return null;

  const close = () => setShowSettings(false);

  return (
    <div className="cap-modal-overlay" onClick={close}>
      <div
        className="cap-modal-panel settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-modal-title"
      >
        <div className="settings-modal-header">
          <div className="settings-modal-header-brand">
            <div className="settings-modal-header-icon" aria-hidden="true">
              <Settings size={15} strokeWidth={2.25} />
            </div>
            <div>
              <h2 id="settings-modal-title">{t("settings.title")}</h2>
              <p className="settings-modal-header-sub">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            className="settings-modal-close"
            onClick={close}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <X size={15} />
          </button>
        </div>

        <div className="settings-modal-body">
          <aside className="settings-modal-rail">
            {profile && (
              <div className="settings-modal-account">
                <div className="settings-modal-account-avatar" aria-hidden="true">
                  {accountInitial(profile.email)}
                </div>
                <div className="settings-modal-account-info">
                  <span className="settings-modal-account-label">{t("auth.signedInAs")}</span>
                  <span className="settings-modal-account-email">{profile.email}</span>
                  {profile.role === "admin" && (
                    <span className="settings-modal-account-badge">{t("auth.roleAdmin")}</span>
                  )}
                </div>
              </div>
            )}

            <nav className="settings-modal-nav" aria-label={t("settings.title")}>
              <button
                type="button"
                className={`settings-modal-nav-item ${settingsTab === "appearance" ? "settings-modal-nav-item--active" : ""}`}
                onClick={() => setSettingsTab("appearance")}
              >
                <Palette size={14} />
                {t("settings.nav.appearance")}
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className={`settings-modal-nav-item ${settingsTab === "users" ? "settings-modal-nav-item--active" : ""}`}
                  onClick={() => setSettingsTab("users")}
                >
                  <Users size={14} />
                  {t("settings.nav.users")}
                </button>
              )}
            </nav>
          </aside>

          <div className="settings-modal-main">
            {settingsTab === "users" && isAdmin ? (
              <UserManagementPanel />
            ) : (
              <AppearancePanel />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
