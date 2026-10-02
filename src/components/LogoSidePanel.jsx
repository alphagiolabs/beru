import { Suspense, useEffect, useState } from "react";
import { shallow } from "zustand/shallow";
import { FolderOpen, Eraser } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import QueueSidebar from "./QueueSidebar";
import { PropertiesPanel, LayerList, preloadEditorPanels } from "./editor-panels";
import PanelLoading from "./PanelLoading";
import { EDITOR_TOOLS, TOOL_COLORS } from "../utils/editor-tools";

function ToolGrid({ activeTool, enabled }) {
  const t = useT();
  return (
    <div className="logo-tool-grid" role="toolbar" aria-label={t("toolbar.label")}>
      {EDITOR_TOOLS.map(({ id, icon: Icon, labelKey }) => {
        const active = activeTool === id;
        return (
          <button
            key={id}
            type="button"
            className={`logo-tool${active ? " is-active" : ""}`}
            style={active ? { "--logo-tool-color": TOOL_COLORS[id] } : undefined}
            disabled={!enabled}
            aria-pressed={active}
            onClick={() => useEditorStore.getState().setActiveTool(id)}
          >
            <Icon size={16} strokeWidth={1.6} aria-hidden />
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function LogoSidePanel() {
  const t = useT();
  const { hasSelection, queueCount, activeTool, currentRegion, selectedOperationIdx } =
    useEditorStore(
      (s) => ({
        hasSelection: s.selectedIdx >= 0 && s.selectedIdx < s.queue.length,
        queueCount: s.queue.length,
        activeTool: s.activeTool,
        currentRegion: s.currentRegion,
        selectedOperationIdx: s.selectedOperationIdx,
      }),
      shallow,
    );
  const [tab, setTab] = useState(hasSelection ? "tools" : "files");

  useEffect(() => {
    if (currentRegion || selectedOperationIdx != null) setTab("tools");
  }, [currentRegion, selectedOperationIdx]);

  useEffect(() => {
    if (!hasSelection) setTab("files");
  }, [hasSelection]);

  const tabs = [
    { id: "files", icon: FolderOpen, label: t("logoWorkspace.files"), count: queueCount },
    { id: "tools", icon: Eraser, label: t("props.modeLogo") },
  ];

  return (
    <aside className="logo-side inspector">
      <div className="logo-side-tabs" role="tablist" aria-label={t("workspace.navigation")}>
        {tabs.map(({ id, icon: Icon, label, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`logo-side-tab${tab === id ? " is-active" : ""}`}
            onClick={() => setTab(id)}
            onPointerEnter={id === "tools" ? preloadEditorPanels : undefined}
            onFocus={id === "tools" ? preloadEditorPanels : undefined}
          >
            <Icon size={14} strokeWidth={1.6} aria-hidden />
            <span>{label}</span>
            {count != null && <span className="logo-side-tab-count">{count}</span>}
          </button>
        ))}
      </div>
      <div className="logo-side-body" role="tabpanel">
        {tab === "files" ? (
          <QueueSidebar />
        ) : (
          <>
            <div className="logo-side-section">
              <span className="logo-side-section-title">{t("logoWorkspace.tools")}</span>
              <ToolGrid activeTool={activeTool} enabled={hasSelection} />
            </div>
            <Suspense fallback={<PanelLoading label={t("workspace.properties")} />}>
              <PropertiesPanel />
              <LayerList />
            </Suspense>
          </>
        )}
      </div>
    </aside>
  );
}
