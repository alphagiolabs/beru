import { useMemo, Suspense } from "react";
import { X, Palette, Users, PawPrint } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import PanelLoading from "./PanelLoading";
import { PetdexPanel, UserManagementPanel, AppearancePanel } from "./settings/settings-panels";

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
    if (settingsTab === "pets") return t("settings.subtitlePets");
    return t("settings.subtitleAppearance");
  }, [settingsTab, t]);

  if (!showSettings) return null;

  const close = () => setShowSettings(false);

  return (
    <div className="cap-modal-overlay settings-modal-overlay" onClick={close}>
      <div
        className="cap-modal-panel settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="settings-modal-header">
          <div className="settings-modal-header-brand">
            <div>
              <h2 id="settings-modal-title">{t("settings.title")}</h2>
              <p className="settings-modal-header-sub">{subtitle}</p>
            </div>
          </div>
          <TooltipProvider>
            <Tooltip label={t("common.close")}>
              <Button
                type="button"
                className="settings-modal-close"
                onClick={close}
                aria-label={t("common.close")}
                variant="tertiary"
                size="icon"
              >
                <X size={15} />
              </Button>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="settings-modal-body">
          <aside className="settings-modal-rail">
            <nav className="settings-modal-nav" aria-label={t("settings.title")}>
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                className={`settings-modal-nav-item ${settingsTab === "appearance" ? "settings-modal-nav-item--active" : ""}`}
                aria-current={settingsTab === "appearance" ? "page" : undefined}
                onClick={() => setSettingsTab("appearance")}
                onPointerEnter={AppearancePanel.preload}
                onFocus={AppearancePanel.preload}
              >
                <Palette size={14} />
                {t("settings.nav.appearance")}
              </Button>
              {isAdmin && (
                <Button
                  type="button"
                  variant="tertiary"
                  size="sm"
                  className={`settings-modal-nav-item ${settingsTab === "users" ? "settings-modal-nav-item--active" : ""}`}
                  aria-current={settingsTab === "users" ? "page" : undefined}
                  onClick={() => setSettingsTab("users")}
                  onPointerEnter={UserManagementPanel.preload}
                  onFocus={UserManagementPanel.preload}
                >
                  <Users size={14} />
                  {t("settings.nav.users")}
                </Button>
              )}
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                className={`settings-modal-nav-item ${settingsTab === "pets" ? "settings-modal-nav-item--active" : ""}`}
                aria-current={settingsTab === "pets" ? "page" : undefined}
                onClick={() => setSettingsTab("pets")}
                onPointerEnter={PetdexPanel.preload}
                onFocus={PetdexPanel.preload}
              >
                <PawPrint size={14} />
                {t("settings.nav.pets")}
              </Button>
            </nav>
            {profile && (
              <div className="settings-modal-account">
                <div className="settings-modal-account-avatar" aria-hidden="true">
                  {accountInitial(profile.email)}
                </div>
                <div className="settings-modal-account-info">
                  <TooltipProvider>
                    <Tooltip label={profile.email}>
                      <span className="settings-modal-account-email">{profile.email}</span>
                    </Tooltip>
                  </TooltipProvider>
                  <span className="settings-modal-account-role">
                    {t(isAdmin ? "auth.roleAdmin" : "auth.roleUser")}
                  </span>
                </div>
              </div>
            )}
          </aside>

          <div
            className={`settings-modal-main${settingsTab === "pets" ? " settings-modal-main--pets" : ""}`}
          >
            <Suspense
              fallback={
                <PanelLoading
                  label={t(
                    settingsTab === "users" && isAdmin
                      ? "settings.nav.users"
                      : settingsTab === "pets"
                        ? "settings.nav.pets"
                        : "settings.nav.appearance",
                  )}
                />
              }
            >
              {settingsTab === "users" && isAdmin ? (
                <UserManagementPanel />
              ) : settingsTab === "pets" ? (
                <PetdexPanel />
              ) : (
                <AppearancePanel />
              )}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
