import { useMemo } from "react";
import {
  Plus,
  FileSpreadsheet,
  Table2,
  Copy,
  Trash2,
  Settings2,
  Bookmark,
  ChevronRight,
  Check,
} from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { ExcelMappingModal, TableEditor } from "./modal-panels";
import { useT } from "../i18n/useT";
import { importExcelFromDialog } from "../utils/import-excel.js";
import { InspectorGroup } from "./inspector";
import { Button } from "./ui/Button";

const api = window.api;

export default function BatchPanel() {
  const {
    templateRegions,
    selectedIdx,
    excelPath,
    excelMapping,
    excelRows,
    selectedTemplateRegionId,
    currentRegion,
    queueLength,
    excelMatchStatus,
  } = useEditorStore(
    (s) => ({
      templateRegions: s.templateRegions,
      selectedIdx: s.selectedIdx,
      excelPath: s.excelPath,
      excelMapping: s.excelMapping,
      excelRows: s.excelRows,
      selectedTemplateRegionId: s.selectedTemplateRegionId,
      currentRegion: s.currentRegion,
      queueLength: s.queue.length,
      excelMatchStatus: s.excelMatchStatus,
    }),
    shallow,
  );
  const isTemplate = useEditorStore((s) => s.selectedIdx >= 0 && s.selectedIdx === s.templateIdx);
  const showToast = useEditorStore((s) => s.showToast);
  const get = useEditorStore.getState;
  const t = useT();
  const report = useMemo(() => {
    const matched = Object.values(excelMatchStatus).filter((s) => s === "matched").length;
    const unmatched = Object.values(excelMatchStatus).filter((s) => s === "unmatched").length;
    const duplicate = Object.values(excelMatchStatus).filter((s) => s === "duplicate").length;
    return { matched, unmatched, duplicate, total: queueLength };
  }, [excelMatchStatus, queueLength]);

  const handleImportExcel = async () => {
    await importExcelFromDialog({ api, store: get(), t, showToast });
  };

  return (
    <div className="batch-panel" data-testid="batch-panel">
      <InspectorGroup
        className="inspector-group--regions"
        title={t("batch.regions")}
        headerAccessory={
          templateRegions.length > 0 ? (
            <span
              className="inspector-region-count"
              aria-label={t("batch.regionCount", { count: templateRegions.length })}
            >
              {templateRegions.length}
            </span>
          ) : null
        }
      >
        {templateRegions.length === 0 ? null : (
          <ul className="inspector-region-list">
            {templateRegions.map((tr, i) => {
              const isSelected = selectedTemplateRegionId === tr.id;
              const x = Math.round(tr.region.x * 100);
              const y = Math.round(tr.region.y * 100);
              const w = Math.round(tr.region.w * 100);
              const h = Math.round(tr.region.h * 100);
              return (
                <li key={tr.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => get().setSelectedTemplateRegion(tr.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        get().setSelectedTemplateRegion(tr.id);
                      }
                    }}
                    className={`inspector-region-row${isSelected ? " is-selected" : ""}`}
                    aria-selected={isSelected}
                  >
                    <span className="inspector-region-row-index" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="inspector-region-row-label">{tr.label}</span>
                    <span
                      className="inspector-region-row-meta"
                      title={`${x}%, ${y}% · ${w}%×${h}%`}
                    >
                      {x}·{y}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        get().removeTemplateRegion(tr.id);
                      }}
                      className="inspector-region-row-delete"
                      aria-label={t("batch.removeRegion", { name: tr.label })}
                      title={t("common.delete")}
                    >
                      <Trash2 size={11} strokeWidth={2} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={get().addTemplateRegion}
          disabled={!currentRegion}
          className="inspector-region-add"
        >
          <Plus size={14} strokeWidth={2} />
          <span>{t("batch.addRegion")}</span>
        </button>
      </InspectorGroup>

      <InspectorGroup title="Excel">
        <div className="flex gap-1.5">
          <Button
            type="button"
            onClick={handleImportExcel}
            onPointerEnter={ExcelMappingModal.preload}
            onFocus={ExcelMappingModal.preload}
            variant="secondary"
            size="sm"
            className="flex-1 !text-[11px]"
          >
            <FileSpreadsheet size={13} />
            {excelPath ? t("batch.excelReimport") : t("batch.importExcel")}
          </Button>
          {excelPath && (
            <button
              type="button"
              onClick={() => get().setShowMappingModal(true)}
              onPointerEnter={ExcelMappingModal.preload}
              onFocus={ExcelMappingModal.preload}
              className="inspector-chip !w-9 !min-h-[32px] !px-0"
              title={t("excel.configureMapping")}
              aria-label={t("excel.configureMapping")}
            >
              <Settings2 size={13} />
            </button>
          )}
        </div>

        {excelPath && (
          <div className="inspector-excel-status">
            <div className="inspector-excel-file" title={excelPath}>
              {excelPath.split(/[\\/]/).pop()}
            </div>
            <div className="inspector-excel-meta">
              <span>
                ID{" "}
                <span className="font-mono" style={{ color: "var(--text-primary)" }}>
                  {excelMapping.idColumn || "—"}
                </span>
              </span>
              {report.total > 0 && (
                <>
                  <span className="inspector-excel-dot" aria-hidden>
                    ·
                  </span>
                  <span style={{ color: "var(--text-brand)" }}>
                    {t("batch.excelMatched", { count: report.matched })}
                  </span>
                  {report.unmatched > 0 && (
                    <span style={{ color: "var(--text-amber)" }}>
                      · {t("batch.excelUnmatched", { count: report.unmatched })}
                    </span>
                  )}
                  {report.duplicate > 0 && (
                    <span style={{ color: "var(--text-rose)" }}>
                      · {t("batch.excelDuplicate", { count: report.duplicate })}
                    </span>
                  )}
                </>
              )}
              {excelRows?.length > 0 && (
                <>
                  <span className="inspector-excel-dot" aria-hidden>
                    ·
                  </span>
                  <span>{t("batch.excelRows", { count: excelRows.length })}</span>
                </>
              )}
            </div>
          </div>
        )}
      </InspectorGroup>

      <InspectorGroup title={t("batch.actions")} className="inspector-group--actions">
        <div className="inspector-action-stack" role="group" aria-label={t("batch.actionsAria")}>
          <Button
            type="button"
            onClick={get().applyToAll}
            variant="tertiary"
            size="sm"
            className="inspector-action-btn inspector-action-btn--apply"
          >
            <span className="inspector-action-icon" aria-hidden>
              <Copy size={14} strokeWidth={2} />
            </span>
            <span className="inspector-action-label">{t("batch.applyLayersToAll")}</span>
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            onClick={() => {
              if (queueLength === 0) {
                showToast({ kind: "warn", text: t("table.needsVideos") });
                return;
              }
              get().setShowTableEditor(true);
            }}
            className="inspector-action-btn"
            onPointerEnter={() => {
              if (queueLength > 0) TableEditor.preload();
            }}
            onFocus={() => {
              if (queueLength > 0) TableEditor.preload();
            }}
          >
            <span className="inspector-action-icon" aria-hidden>
              <Table2 size={14} strokeWidth={2} />
            </span>
            <span className="inspector-action-label">{t("batch.tableEditor")}</span>
            <ChevronRight size={12} className="inspector-action-trailing" aria-hidden />
          </Button>
          <div className="inspector-action-divider" role="separator" />
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            onClick={() => get().setTemplate(selectedIdx)}
            className={`inspector-action-btn${isTemplate ? " is-active" : ""}`}
            aria-pressed={isTemplate}
          >
            <span className="inspector-action-icon" aria-hidden>
              <Bookmark size={14} strokeWidth={2} fill={isTemplate ? "currentColor" : "none"} />
            </span>
            <span className="inspector-action-label">{t("batch.markAsTemplate")}</span>
            <Check
              size={13}
              className={`inspector-action-trailing${isTemplate ? " is-visible" : " is-hidden"}`}
              aria-hidden
            />
          </Button>
        </div>
      </InspectorGroup>
    </div>
  );
}
