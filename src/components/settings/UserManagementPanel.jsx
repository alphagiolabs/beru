import { useCallback, useEffect, useState } from "react";
import { Loader2, Shield, ShieldOff, UserPlus, Users } from "lucide-react";
import useEditorStore from "../../stores/useEditorStore";
import { useT } from "../../i18n/useT";

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
        <Shield size={20} />
        <p>{t("auth.adminOnly")}</p>
      </div>
    );
  }

  return (
    <div className="settings-users">
      <div className="settings-users-section">
        <div className="settings-users-section-head">
          <UserPlus size={14} />
          <span>{t("auth.addUser")}</span>
        </div>
        <form className="settings-users-form" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder={t("auth.fullName")}
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            disabled={creating}
          />
          <input
            type="email"
            placeholder={t("auth.email")}
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            disabled={creating}
            required
          />
          <input
            type="password"
            placeholder={t("auth.passwordMin")}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            disabled={creating}
            minLength={6}
            required
          />
          <button type="submit" className="cap-btn-primary text-[11px] !py-1.5" disabled={creating}>
            {creating ? <Loader2 size={13} className="login-screen-spin" /> : <UserPlus size={13} />}
            {t("auth.addUserBtn")}
          </button>
        </form>
      </div>

      <div className="settings-users-section">
        <div className="settings-users-section-head">
          <Users size={14} />
          <span>{t("auth.userList")}</span>
          <span className="settings-users-count">{users.length}</span>
        </div>

        {loading ? (
          <div className="settings-users-loading">
            <Loader2 size={16} className="login-screen-spin" />
          </div>
        ) : users.length === 0 ? (
          <p className="settings-users-empty-text">{t("auth.noUsers")}</p>
        ) : (
          <ul className="settings-users-list">
            {users.map((u) => {
              const isSelf = u.id === user?.id;
              return (
                <li key={u.id} className={`settings-users-row${u.is_active ? "" : " settings-users-row--disabled"}`}>
                  <div className="settings-users-row-info">
                    <span className="settings-users-row-email">{u.email}</span>
                    {u.full_name && (
                      <span className="settings-users-row-name">{u.full_name}</span>
                    )}
                    <span className="settings-users-row-meta">
                      {u.role === "admin" ? t("auth.roleAdmin") : t("auth.roleUser")}
                      {isSelf && ` · ${t("auth.you")}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`settings-users-toggle${u.is_active ? "" : " settings-users-toggle--off"}`}
                    onClick={() => handleToggle(u)}
                    disabled={isSelf || togglingId === u.id}
                    title={u.is_active ? t("auth.disable") : t("auth.enable")}
                  >
                    {togglingId === u.id ? (
                      <Loader2 size={13} className="login-screen-spin" />
                    ) : u.is_active ? (
                      <Shield size={13} />
                    ) : (
                      <ShieldOff size={13} />
                    )}
                    <span>{u.is_active ? t("auth.active") : t("auth.inactive")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
