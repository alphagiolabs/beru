import { useRef, useState } from "react";
import { Library, History, X, ChevronDown } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import useCloseOnOutsideClick from "../hooks/useCloseOnOutsideClick";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/tooltip";

export function PresetsMenu({ placement = "header" }) {
  const { presets, queueLength } = useEditorStore(
    (s) => ({ presets: s.presets, queueLength: s.queue.length }),
    shallow,
  );
  const get = useEditorStore.getState;
  const showToast = useEditorStore((s) => s.showToast);
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const inRail = placement === "rail";

  useCloseOnOutsideClick(ref, open, setOpen);

  const handleToggle = async () => {
    if (!open && presets.length === 0) await get().loadPresets();
    setOpen((v) => !v);
  };

  const handleApply = async (preset) => {
    setOpen(false);
    if (queueLength > 0) {
      const ok = await get().requestConfirm({
        message: t("header.confirmApplyPreset", { name: preset.name }),
      });
      if (!ok) return;
    }
    const res = get().applyPreset(preset.data);
    if (res.ok) showToast({ kind: "ok", text: t("header.presetApplied", { name: preset.name }) });
    else showToast({ kind: "err", text: res.error || t("header.couldNotApply") });
  };

  const menuClass = inRail
    ? `rail-item rail-menu-btn${open ? " is-open" : ""}`
    : `app-header-icon-btn app-header-icon-btn--menu${open ? " is-open" : ""}`;

  return (
    <div className="relative" ref={ref}>
      <Tooltip label={t("header.presetsLibrary")} side={inRail ? "right" : "bottom"}>
        <Button
          type="button"
          onClick={handleToggle}
          variant="tertiary"
          size="icon"
          className={menuClass}
          aria-label={t("header.presetsLibrary")}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Library size={inRail ? 16 : 15} strokeWidth={inRail ? 1.5 : 2} />
          {!inRail && (
            <ChevronDown size={10} className={`header-presets-chevron${open ? " is-open" : ""}`} />
          )}
        </Button>
      </Tooltip>
      {open && (
        <div
          className={`header-presets-menu${inRail ? " header-presets-menu--rail" : ""}`}
          role="menu"
          aria-label={t("header.presets")}
        >
          <div className="header-presets-menu-chrome">
            <div className="header-presets-menu-title">{t("header.presets")}</div>
          </div>
          <div className="header-presets-menu-scroll">
            {presets.length === 0 ? (
              <div className="header-presets-empty">
                <Library size={16} strokeWidth={1.75} className="header-presets-empty-icon" />
                <span>{t("header.noPresets")}</span>
              </div>
            ) : (
              presets.map((p) => (
                <div key={p.filename} className="header-presets-group">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleApply(p)}
                    className="header-presets-item"
                  >
                    <span className="header-presets-item-name">{p.name}</span>
                    {p.description ? (
                      <span className="header-presets-item-desc">{p.description}</span>
                    ) : null}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RecentMenu({ placement = "header" }) {
  const { recent, queueLength } = useEditorStore(
    (s) => ({ recent: s.recent, queueLength: s.queue.length }),
    shallow,
  );
  const get = useEditorStore.getState;
  const showToast = useEditorStore((s) => s.showToast);
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const inRail = placement === "rail";

  useCloseOnOutsideClick(ref, open, setOpen);

  const handleOpen = async (entry) => {
    setOpen(false);
    if (!entry?.path) return;
    if (queueLength > 0) {
      const ok = await get().requestConfirm({ message: t("header.confirmLoadRecent") });
      if (!ok) return;
    }
    const res = await get().loadProjectFromPath(entry.path);
    if (res.ok) {
      showToast({
        kind: "ok",
        text: t("header.loadedFrom", { name: entry.name || entry.path.split(/[\\/]/).pop() }),
      });
    } else if (res.error && /no encontrad|not found|missing/i.test(res.error)) {
      showToast({ kind: "err", text: t("header.recentMissing") });
    } else {
      showToast({ kind: "err", text: res.error || t("header.couldNotLoad") });
    }
  };

  const menuClass = inRail
    ? `rail-item rail-menu-btn${open ? " is-open" : ""}`
    : `app-header-icon-btn app-header-icon-btn--menu${open ? " is-open" : ""}`;

  return (
    <div className="relative" ref={ref}>
      <Tooltip label={t("header.recent")} side={inRail ? "right" : "bottom"}>
        <Button
          onClick={() => setOpen((v) => !v)}
          variant="tertiary"
          size="icon"
          className={menuClass}
          aria-label={t("header.recent")}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <History size={inRail ? 16 : 15} strokeWidth={inRail ? 1.5 : 2} />
          {!inRail && <ChevronDown size={10} />}
        </Button>
      </Tooltip>
      {open && (
        <div
          className={`header-recents-menu${inRail ? " header-recents-menu--rail" : ""}`}
          role="menu"
          aria-label={t("header.recent")}
        >
          {recent.length === 0 ? (
            <div className="px-3 py-2 text-[11px]" style={{ color: "var(--text-dim)" }}>
              {t("header.noRecents")}
            </div>
          ) : (
            <div className="py-1 max-h-[280px] overflow-y-auto">
              {recent.map((r) => (
                <div
                  key={r.path}
                  onClick={() => handleOpen(r)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleOpen(r);
                    }
                  }}
                  role="menuitem"
                  tabIndex={0}
                  aria-label={r.name}
                  className="header-recent-item group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:opacity-80"
                  style={{ opacity: r.exists === false ? 0.4 : 1 }}
                >
                  <History
                    size={11}
                    style={{ color: "var(--text-dim)" }}
                    className="flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[11px] font-medium truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {r.name || r.path.split(/[\\/]/).pop()}
                    </div>
                    <div
                      className="text-[9px] truncate"
                      style={{ color: "var(--text-dim)" }}
                      title={r.path}
                    >
                      {r.path}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void get().removeRecent(r.path);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 flex-shrink-0"
                    style={{ color: "var(--text-dim)" }}
                    title={t("common.remove")}
                    aria-label={t("common.remove")}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
