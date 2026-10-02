import { shallow } from "zustand/shallow";
import {
  Eraser,
  Type,
  Droplets,
  Settings,
  Languages,
  Sun,
  Moon,
  Table2,
  FileSpreadsheet,
  LogOut,
} from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { useT, SUPPORTED_LANGUAGES } from "../i18n/useT";
import { resolveThemeName } from "../theme/engine.js";
import { importExcelFromDialog } from "../utils/import-excel.js";
import { Button } from "./ui/Button";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { PresetsMenu, RecentMenu } from "./ProjectMenus";
import { TableEditor, ExcelMappingModal, WatermarkModal, SettingsModal } from "./modal-panels";
import { preloadEditorPanels } from "./editor-panels";
import { AppearancePanel, UserManagementPanel, PetdexPanel } from "./settings/settings-panels";

function RailItem({ label, icon: Icon, active, onClick, onIntent, disabled }) {
  return (
    <Tooltip label={label} side="right">
      <Button
        type="button"
        onClick={onClick}
        onPointerEnter={disabled ? undefined : onIntent}
        onFocus={disabled ? undefined : onIntent}
        disabled={disabled}
        variant="tertiary"
        size="icon"
        className={`rail-item${active ? " is-active" : ""}`}
        aria-label={label}
        aria-current={active ? "page" : undefined}
      >
        <Icon size={16} strokeWidth={1.5} />
      </Button>
    </Tooltip>
  );
}

function AccountMenu() {
  const profile = useEditorStore((s) => s.profile);
  const t = useT();
  const email = profile?.email ?? "";
  const name = profile?.full_name?.trim() || email;

  const handleSignOut = async () => {
    const { requestConfirm, signOut, showToast } = useEditorStore.getState();
    if (!(await requestConfirm({ message: t("auth.signOutConfirm") }))) return;
    await signOut();
    showToast({ kind: "ok", text: t("auth.signedOut") });
  };

  return (
    <DropdownMenu>
      <Tooltip label={name} side="right">
        <DropdownMenuTrigger asChild>
          <button type="button" className="rail-avatar" aria-label={t("auth.account")}>
            {(name[0] ?? "?").toUpperCase()}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" side="right" sideOffset={10} className="min-w-[200px]">
        <div className="rail-account-head">
          <span className="rail-account-name">{name}</span>
          {name !== email && <span className="rail-account-email">{email}</span>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut strokeWidth={1.75} />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppRail() {
  const { sidebarMode, isProcessing, language, themeActiveSlot, themeSlot1, themeSlot2 } =
    useEditorStore(
      (s) => ({
        sidebarMode: s.sidebarMode,
        isProcessing: s.isProcessing,
        language: s.language,
        themeActiveSlot: s.themeActiveSlot,
        themeSlot1: s.themeSlot1,
        themeSlot2: s.themeSlot2,
      }),
      shallow,
    );
  const customThemes = useEditorStore((s) => s.customThemes);
  const get = useEditorStore.getState;
  const showToast = useEditorStore((s) => s.showToast);
  const t = useT();
  const isLogoMode = sidebarMode === "logo";
  const api = window.api;
  const themeSwitchLabel = t("header.themeSwitchTo", {
    name: resolveThemeName(themeActiveSlot === 1 ? themeSlot2 : themeSlot1, customThemes, t),
  });

  return (
    <TooltipProvider>
      <nav className="app-rail" aria-label={t("workspace.navigation")}>
        <div className="app-rail-group" role="radiogroup" aria-label={t("props.panelMode")}>
          <RailItem
            label={t("props.modeLogo")}
            icon={Eraser}
            active={isLogoMode}
            onClick={() => get().setSidebarMode("logo")}
          />
          <RailItem
            label={t("props.modeBatch")}
            onIntent={preloadEditorPanels}
            icon={Type}
            active={!isLogoMode}
            onClick={() => get().setSidebarMode("batch")}
          />
        </div>

        <div className="app-rail-sep" role="separator" aria-hidden />

        <div className="app-rail-group">
          <RailItem
            label={t("batch.tableEditor")}
            onIntent={() => {
              if (get().queue.length > 0) TableEditor.preload();
            }}
            icon={Table2}
            onClick={() => {
              const s = get();
              if (s.queue.length === 0) {
                showToast({ kind: "warn", text: t("table.needsVideos") });
                return;
              }
              s.setShowTableEditor(true);
            }}
          />
          <RailItem
            label={t("batch.excelImport")}
            onIntent={ExcelMappingModal.preload}
            icon={FileSpreadsheet}
            onClick={() => {
              void importExcelFromDialog({ api, store: get(), t, showToast });
            }}
          />
          <RailItem
            label={t("header.watermark")}
            onIntent={WatermarkModal.preload}
            icon={Droplets}
            disabled={isProcessing}
            onClick={() => get().setShowWatermarkModal(true)}
          />
        </div>

        <div className="app-rail-sep" role="separator" aria-hidden />

        <div className="app-rail-group">
          <PresetsMenu placement="rail" />
          <RecentMenu placement="rail" />
        </div>

        <div className="app-rail-spacer" aria-hidden />

        <div className="app-rail-group">
          <Tooltip label={themeSwitchLabel} side="right">
            <Button
              onClick={() => get().toggleTheme()}
              onContextMenu={(e) => {
                e.preventDefault();
                get().openSettingsTab("appearance");
              }}
              variant="tertiary"
              size="icon"
              className="rail-item"
              aria-label={themeSwitchLabel}
            >
              {themeActiveSlot === 1 ? (
                <Sun size={16} strokeWidth={1.5} />
              ) : (
                <Moon size={16} strokeWidth={1.5} />
              )}
            </Button>
          </Tooltip>
          <DropdownMenu>
            <Tooltip label={t("header.language")} side="right">
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="tertiary"
                  size="icon"
                  className="rail-item"
                  aria-label={t("header.language")}
                >
                  <Languages size={16} strokeWidth={1.5} />
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent
              align="start"
              side="right"
              sideOffset={8}
              className="min-w-[168px]"
            >
              <DropdownMenuLabel>{t("header.language")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={language}
                onValueChange={(code) => get().setLanguage(code)}
              >
                {SUPPORTED_LANGUAGES.map((lng) => (
                  <DropdownMenuRadioItem key={lng.code} value={lng.code}>
                    {lng.label}
                    <span className="header-lang-item-code">{lng.code.toUpperCase()}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <RailItem
            label={t("header.settings")}
            onIntent={() => {
              SettingsModal.preload();
              const state = get();
              if (state.settingsTab === "users" && state.profile?.role === "admin")
                UserManagementPanel.preload();
              else if (state.settingsTab === "pets") PetdexPanel.preload();
              else AppearancePanel.preload();
            }}
            icon={Settings}
            onClick={() => get().setShowSettings(true)}
          />
          {isSupabaseConfigured && <AccountMenu />}
        </div>
      </nav>
    </TooltipProvider>
  );
}
