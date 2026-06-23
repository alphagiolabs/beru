import { X, Settings, Keyboard } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import UserManagementPanel from "./settings/UserManagementPanel";

export default function SettingsModal() {
  const showSettings = useEditorStore((s) => s.showSettings);
  const setShowSettings = useEditorStore((s) => s.setShowSettings);
  const setShowShortcuts = useEditorStore((s) => s.setShowShortcuts);
  const profile = useEditorStore((s) => s.profile);
  const t = useT();

  if (!showSettings) return null;

  const close = () => setShowSettings(false);

  const openShortcuts = () => {
    close();
    setShowShortcuts(true);
  };

  return (
    <div className="cap-modal-overlay" onClick={close}>
      <div
        className="cap-modal-panel settings-modal max-w-[520px] p-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-modal-title"
      >
        <div className="settings-modal-header">
          <div className="settings-modal-header-left">
            <Settings size={16} />
            <h2 id="settings-modal-title">{t("settings.title")}</h2>
          </div>
          <button
            type="button"
            className="cap-btn-secondary !p-1"
            onClick={close}
            title={t("common.close")}
          >
            <X size={14} />
          </button>
        </div>

        <div className="settings-modal-body">
          {profile && (
            <div className="settings-modal-account">
              <span className="settings-modal-account-label">{t("auth.signedInAs")}</span>
              <span className="settings-modal-account-email">{profile.email}</span>
              {profile.role === "admin" && (
                <span className="settings-modal-account-badge">{t("auth.roleAdmin")}</span>
              )}
            </div>
          )}

          <UserManagementPanel />

          <div className="settings-modal-shortcuts-link">
            <button type="button" className="settings-modal-link-btn" onClick={openShortcuts}>
              <Keyboard size={14} />
              {t("settings.openShortcuts")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
