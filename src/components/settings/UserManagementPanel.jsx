import { useCallback, useEffect, useState } from "react";
import { Loader2, Shield, UserPlus, Users } from "lucide-react";
import { Button } from "../ui/Button";
import { Tooltip, TooltipProvider } from "../ui/tooltip";
import useEditorStore from "../../stores/useEditorStore";
import { useT } from "../../i18n/useT";

function userInitial(email) {
  const ch = email?.trim()?.[0];
  return ch ? ch.toUpperCase() : "?";
}

export default function UserManagementPanel() {
  const t = useT();
  const profile = useEditorStore((s) => s.profile);
  const user = useEditorStore((s) => s.user);
  const listUsers = useEditorStore((s) => s.listUsers);
  const createUser = useEditorStore((s) => s.createUser);
  const toggleUserActive = useEditorStore((s) => s.toggleUserActive);
  const showToast = useEditorStore((s) => s.showToast);
  const requestConfirm = useEditorStore((s) => s.requestConfirm);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [form, setForm] = useState({ email: "", password: "", fullName: "" });

  const isAdmin = profile?.role === "admin";

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const res = await listUsers();
    setLoading(false);
    if (res.ok) setUsers(res.users);
    else showToast({ kind: "err", text: res.error || t("auth.loadUsersFailed") });
  }, [isAdmin, listUsers, showToast, t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || form.password.length < 6) {
      showToast({ kind: "warn", text: t("auth.createUserValidation") });
      return;
    }

    setCreating(true);
    const res = await createUser({
      email: form.email,
      password: form.password,
      fullName: form.fullName,
    });
    setCreating(false);

    if (res.ok) {
      showToast({ kind: "ok", text: t("auth.userCreated") });
      setForm({ email: "", password: "", fullName: "" });
      await loadUsers();
    } else {
      showToast({ kind: "err", text: res.error || t("auth.createUserFailed") });
    }
  };

  const handleToggle = async (target) => {
    const nextActive = !target.is_active;
    const confirmKey = nextActive ? "auth.confirmEnable" : "auth.confirmDisable";

    const ok = await requestConfirm({
      message: t(confirmKey, { email: target.email }),
      confirmLabel: nextActive ? t("auth.enable") : t("auth.disable"),
      variant: nextActive ? "default" : "danger",
    });
    if (!ok) return;

    setTogglingId(target.id);
    const res = await toggleUserActive(target.id, nextActive);
    setTogglingId(null);

    if (res.ok) {
      showToast({
        kind: "ok",
        text: nextActive ? t("auth.userEnabled") : t("auth.userDisabled"),
      });
      await loadUsers();
    } else {
      showToast({ kind: "err", text: res.error || t("auth.toggleFailed") });
    }
  };

  if (!isAdmin) {
    return (
      <div className="settings-users-empty">
        <div className="settings-users-empty-icon">
          <Shield size={18} />
        </div>
        <p>{t("auth.adminOnly")}</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="settings-users">
        <section className="settings-users-directory" aria-labelledby="settings-users-title">
          <header className="settings-users-heading">
            <h3 id="settings-users-title">{t("auth.userList")}</h3>
            {!loading && <span className="settings-users-count">{users.length}</span>}
          </header>

          <div className="settings-users-list-scroll" aria-busy={loading}>
            {loading ? (
              <div
                className="settings-users-loading"
                role="status"
                aria-label={t("auth.loadingUsers")}
              >
                <Loader2 size={18} className="login-screen-spin" aria-hidden />
              </div>
            ) : users.length === 0 ? (
              <div className="settings-users-empty-inline">
                <Users size={20} strokeWidth={1.5} aria-hidden />
                <p>{t("auth.noUsers")}</p>
              </div>
            ) : (
              <table className="settings-users-table">
                <caption className="sr-only">{t("auth.userList")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("auth.roleUser")}</th>
                    <th scope="col" className="settings-users-role-column">
                      {t("auth.roleColumn")}
                    </th>
                    <th scope="col" className="settings-users-status-column">
                      {t("auth.statusColumn")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === user?.id;
                    const displayName = u.full_name?.trim() || u.email;
                    const statusLabel = t(u.is_active ? "auth.active" : "auth.inactive");
                    const toggleLabel = `${t(u.is_active ? "auth.disable" : "auth.enable")}: ${u.email}`;
                    const status = (
                      <>
                        {togglingId === u.id ? (
                          <Loader2 size={12} className="login-screen-spin" aria-hidden />
                        ) : (
                          <span className="settings-users-status-dot" aria-hidden />
                        )}
                        <span>{statusLabel}</span>
                      </>
                    );
                    return (
                      <tr
                        key={u.id}
                        className={`settings-users-row${u.is_active ? "" : " settings-users-row--disabled"}`}
                      >
                        <td>
                          <div className="settings-users-person">
                            <div className="settings-users-avatar" aria-hidden>
                              {userInitial(displayName)}
                            </div>
                            <div className="settings-users-row-info">
                              <div className="settings-users-row-top">
                                <Tooltip label={displayName}>
                                  <span className="settings-users-row-title">{displayName}</span>
                                </Tooltip>
                                {isSelf && (
                                  <span className="settings-users-you">{t("auth.you")}</span>
                                )}
                              </div>
                              {u.full_name?.trim() && (
                                <Tooltip label={u.email}>
                                  <span className="settings-users-row-sub">{u.email}</span>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="settings-users-row-role">
                          {t(u.role === "admin" ? "auth.roleAdmin" : "auth.roleUser")}
                        </td>
                        <td>
                          {isSelf ? (
                            <span
                              className={`settings-users-status${u.is_active ? "" : " settings-users-toggle--off"}`}
                            >
                              {status}
                            </span>
                          ) : (
                            <Tooltip label={toggleLabel}>
                              <Button
                                type="button"
                                variant="tertiary"
                                size="sm"
                                className={`settings-users-toggle${u.is_active ? "" : " settings-users-toggle--off"}`}
                                onClick={() => handleToggle(u)}
                                disabled={togglingId === u.id}
                                aria-label={toggleLabel}
                              >
                                {status}
                              </Button>
                            </Tooltip>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="settings-users-add" aria-labelledby="settings-users-add-title">
          <header className="settings-users-heading">
            <h3 id="settings-users-add-title">{t("auth.addUser")}</h3>
          </header>
          <form className="settings-users-form" onSubmit={handleCreate}>
            <label className="settings-field">
              <span className="settings-field-label">{t("auth.fullNameLabel")}</span>
              <input
                type="text"
                placeholder={t("auth.fullNamePlaceholder")}
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                disabled={creating}
                autoComplete="name"
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("auth.email")}</span>
              <input
                type="email"
                placeholder={t("auth.emailPlaceholder")}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                disabled={creating}
                required
                autoComplete="off"
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("auth.password")}</span>
              <input
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                disabled={creating}
                minLength={6}
                required
                autoComplete="new-password"
              />
            </label>
            <div className="settings-users-form-actions">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="settings-users-submit"
                loading={creating}
                disabled={creating}
              >
                <UserPlus size={14} strokeWidth={2.25} />
                {t("auth.addUserBtn")}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </TooltipProvider>
  );
}
