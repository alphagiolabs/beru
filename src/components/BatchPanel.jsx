import { useMemo } from "react";
import { Plus, FileSpreadsheet, Table2, Copy, Trash2, Settings2, Bookmark } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { textOpMatchesRegion } from "../utils/text-style";
import { InspectorGroup } from "./inspector";

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
    // Warn when Excel will replace text ops linked to template regions (_reapplyExcel preserves non-text ops)
    const hasLinkedTextToOverwrite = get().queue.some((v) =>
      v.operations.some(
        (op) =>
          op.mode === "text" &&
          templateRegions.some((tr) => tr.region && textOpMatchesRegion(op, tr.region, tr.id)),
      ),
    );
    if (hasLinkedTextToOverwrite) {
      const ok = await get().requestConfirm({ message: t("batch.confirmExcelOverwrite") });
      if (!ok) return;
    }

    const path = await api?.openExcel();
    if (!path) return;
    const result = await get().importExcel(path);
    if (!result.success) {
      showToast({
        kind: "err",
        text: t("batch.excelParseError", {
          message: result.error || t("errors.unknown"),
        }),
      });
    } else {
      const mapping = get().excelMapping;
      if (!mapping.idColumn || Object.keys(mapping.columns).length === 0) {
        get().setShowMappingModal(true);
      } else {
        showToast({
          kind: "ok",
          text: result.message || t("batch.excelLinked", { count: result.rowCount ?? 0 }),
        });
      }
    }
  };

  return (
    <div className="space-y-2.5">
      <InspectorGroup
        className="inspector-group--regions"
        title="Regiones de texto"
        headerAccessory={
          templateRegions.length > 0 ? (
            <span className="inspector-region-count" aria-label={`${templateRegions.length} regiones`}>
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
                    <span className="inspector-region-row-meta" title={`${x}%, ${y}% · ${w}%×${h}%`}>
                      {x}·{y}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        get().removeTemplateRegion(tr.id);
                      }}
                      className="inspector-region-row-delete"
                      aria-label={`Eliminar ${tr.label}`}
                      title="Eliminar"
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
          <Plus size={12} strokeWidth={2.25} />
          <span>Agregar región actual</span>
        </button>
      </InspectorGroup>

      <InspectorGroup title="Excel">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleImportExcel}
            className="cap-btn-secondary flex-1 !text-[11px]"
          >
            <FileSpreadsheet size={13} />
            {excelPath ? "Reimportar Excel" : "Importar Excel"}
          </button>
          {excelPath && (
            <button
              type="button"
              onClick={() => get().setShowMappingModal(true)}
              className="inspector-chip !w-9 !min-h-[32px] !px-0"
              title="Configurar mapeo"
              aria-label="Configurar mapeo"
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
                  <span style={{ color: "var(--accent-brand)" }}>{report.matched} ok</span>
                  {report.unmatched > 0 && (
                    <span style={{ color: "var(--amber)" }}>· {report.unmatched} sin match</span>
                  )}
                  {report.duplicate > 0 && (
                    <span style={{ color: "var(--rose)" }}>· {report.duplicate} dup</span>
                  )}
                </>
              )}
              {excelRows?.length > 0 && (
                <>
                  <span className="inspector-excel-dot" aria-hidden>
                    ·
                  </span>
                  <span>{excelRows.length} filas</span>
                </>
              )}
            </div>
          </div>
        )}
      </InspectorGroup>

      <InspectorGroup title="Acciones" className="inspector-group--actions">
        <div className="inspector-action-stack" role="group" aria-label="Acciones de lote">
          <button type="button" onClick={get().applyToAll} className="inspector-action-btn">
            <span className="inspector-action-icon" aria-hidden>
              <Copy size={13} strokeWidth={2} />
            </span>
            <span className="inspector-action-label">Aplicar capas a todos</span>
          </button>
          <button
            type="button"
            onClick={() => get().setShowTableEditor(true)}
            className="inspector-action-btn"
          >
            <span className="inspector-action-icon" aria-hidden>
              <Table2 size={13} strokeWidth={2} />
            </span>
            <span className="inspector-action-label">Editor de tabla</span>
          </button>
          <button
            type="button"
            onClick={() => get().setTemplate(selectedIdx)}
            className="inspector-action-btn inspector-action-btn--accent"
          >
            <span className="inspector-action-icon" aria-hidden>
              <Bookmark size={13} strokeWidth={2} />
            </span>
            <span className="inspector-action-label">Marcar como plantilla</span>
          </button>
        </div>
      </InspectorGroup>
    </div>
  );
}
