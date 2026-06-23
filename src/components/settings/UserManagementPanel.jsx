import { useCallback, useEffect, useState } from "react";
import { Loader2, Shield, ShieldOff, UserPlus, Users } from "lucide-react";
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
      <div className="settings-card settings-users-empty settings-users-empty--wide">
        <div className="settings-users-empty-icon">
          <Shield size={18} />
        </div>
        <p>{t("auth.adminOnly")}</p>
      </div>
    );
  }

  return (
    <div className="settings-users settings-users--horizontal">
      <section className="settings-card settings-card--add">
        <header className="settings-card-head">
          <div className="settings-card-head-left">
            <UserPlus size={14} strokeWidth={2.25} />
            <span>{t("auth.addUser")}</span>
          </div>
        </header>
        <form className="settings-users-form settings-users-form--compact" onSubmit={handleCreate}>
          <label className="settings-field settings-field--full">
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
              placeholder="usuario@empresa.com"
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
            <button type="submit" className="settings-users-submit" disabled={creating}>
              {creating ? (
                <Loader2 size={14} className="login-screen-spin" />
              ) : (
                <UserPlus size={14} strokeWidth={2.25} />
              )}
              {t("auth.addUserBtn")}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-card settings-card--list">
        <header className="settings-card-head">
          <div className="settings-card-head-left">
            <Users size={14} strokeWidth={2.25} />
            <span>{t("auth.userList")}</span>
          </div>
          <span className="settings-users-count">{users.length}</span>
        </header>

        <div className="settings-users-list-scroll">
          {loading ? (
            <div className="settings-users-loading">
              <Loader2 size={18} className="login-screen-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="settings-users-empty-inline">
              <Users size={16} strokeWidth={2} />
              <p>{t("auth.noUsers")}</p>
            </div>
          ) : (
            <ul className="settings-users-list">
              {users.map((u) => {
                const isSelf = u.id === user?.id;
                const isAdminUser = u.role === "admin";
                const displayName = u.full_name?.trim() || u.email;
                return (
                  <li
                    key={u.id}
                    className={`settings-users-row${u.is_active ? "" : " settings-users-row--disabled"}`}
                  >
                    <div
                      className={`settings-users-avatar${isAdminUser ? " settings-users-avatar--admin" : ""}`}
                      aria-hidden="true"
                    >
                      {userInitial(displayName)}
                    </div>
                    <div className="settings-users-row-info">
                      <div className="settings-users-row-top">
                        <span className="settings-users-row-title">{displayName}</span>
                        {isSelf && <span className="settings-users-you">{t("auth.you")}</span>}
                        <span className="settings-users-row-role">
                          {isAdminUser ? t("auth.roleAdmin") : t("auth.roleUser")}
                        </span>
                      </div>
                      {u.full_name?.trim() && (
                        <span className="settings-users-row-sub">{u.email}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={`settings-users-toggle${u.is_active ? "" : " settings-users-toggle--off"}`}
                      onClick={() => handleToggle(u)}
                      disabled={isSelf || togglingId === u.id}
                      title={u.is_active ? t("auth.disable") : t("auth.enable")}
                    >
                      {togglingId === u.id ? (
                        <Loader2 size={12} className="login-screen-spin" />
                      ) : u.is_active ? (
                        <Shield size={12} strokeWidth={2.25} />
                      ) : (
                        <ShieldOff size={12} strokeWidth={2.25} />
                      )}
                      <span>{u.is_active ? t("auth.active") : t("auth.inactive")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
