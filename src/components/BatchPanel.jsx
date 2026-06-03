import { Plus, FileSpreadsheet, Table2, Copy, Trash2, Settings2 } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

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
    queue,
  } = useEditorStore(
    (s) => ({
      templateRegions: s.templateRegions,
      selectedIdx: s.selectedIdx,
      excelPath: s.excelPath,
      excelMapping: s.excelMapping,
      excelRows: s.excelRows,
      selectedTemplateRegionId: s.selectedTemplateRegionId,
      currentRegion: s.currentRegion,
      queue: s.queue,
    }),
    shallow,
  );
  const showToast = useEditorStore((s) => s.showToast);
  const get = useEditorStore.getState;
  const t = useT();
  const report = get().getMatchReport();

  const handleImportExcel = async () => {
    // Warn if any videos have manual (non-text) operations that will be overwritten
    const hasManualOps = queue.some((v) => v.operations.some((op) => op.mode !== "text"));
    if (hasManualOps) {
      if (!confirm(t("batch.confirmExcelOverwrite"))) return;
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
    <div className="space-y-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      {/* Template regions */}
      <div className="cap-input-label">Regiones de texto ({templateRegions.length})</div>
      {templateRegions.length > 0 && (
        <p className="text-[9px] leading-relaxed mb-1" style={{ color: "var(--text-dim)" }}>
          Selecciona una región para previsualizar y editar su estilo en el video.
        </p>
      )}
      {templateRegions.map((tr) => {
        const isSelected = selectedTemplateRegionId === tr.id;
        return (
          <div
            key={tr.id}
            role="button"
            tabIndex={0}
            onClick={() => get().setSelectedTemplateRegion(tr.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                get().setSelectedTemplateRegion(tr.id);
              }
            }}
            className="flex items-center gap-2 p-2 rounded cursor-pointer"
            style={{
              background: isSelected ? "rgba(168,85,247,0.15)" : "var(--bg-elevated)",
              border: `1px solid ${isSelected ? "var(--purple)" : "rgba(168,85,247,0.3)"}`,
              boxShadow: isSelected ? "0 0 0 1px rgba(168,85,247,0.35)" : "none",
            }}
          >
            <span
              className="flex-1 text-[11px] font-mono"
              style={{ color: isSelected ? "var(--purple)" : "var(--text-secondary)" }}
            >
              {tr.label}
            </span>
            <span className="text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
              {(tr.region.x * 100).toFixed(1)}%,{(tr.region.y * 100).toFixed(1)}%{" "}
              {(tr.region.w * 100).toFixed(1)}%×{(tr.region.h * 100).toFixed(1)}%
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                get().removeTemplateRegion(tr.id);
              }}
              className="p-0.5 rounded hover:bg-red-500/20"
              style={{ color: "var(--text-dim)" }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        );
      })}

      <button
        onClick={get().addTemplateRegion}
        disabled={!currentRegion}
        className="cap-btn-secondary w-full text-[10px]"
      >
        <Plus size={12} /> Agregar región actual
      </button>

      {/* Excel import */}
      <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex gap-1 mb-1">
          <button onClick={handleImportExcel} className="cap-btn-secondary flex-1 text-[10px]">
            <FileSpreadsheet size={12} /> {excelPath ? "Reimportar Excel" : "Importar Excel"}
          </button>
          {excelPath && (
            <button
              onClick={() => get().setShowMappingModal(true)}
              className="cap-btn-secondary !p-1.5"
              title="Configurar mapeo"
            >
              <Settings2 size={12} />
            </button>
          )}
        </div>
        {excelPath && (
          <>
            <div
              className="text-[9px] truncate mb-1"
              style={{ color: "var(--text-dim)" }}
              title={excelPath}
            >
              {excelPath.split(/[\\/]/).pop()}
            </div>
            <div
              className="flex items-center gap-1.5 text-[9px] mb-1"
              style={{ color: "var(--text-dim)" }}
            >
              <span>ID:</span>
              <span className="font-mono" style={{ color: "var(--accent)" }}>
                {excelMapping.idColumn || "—"}
              </span>
              {report.total > 0 && (
                <>
                  <span>·</span>
                  <span style={{ color: "var(--accent)" }}>{report.matched} ✓</span>
                  {report.unmatched > 0 && (
                    <span style={{ color: "var(--amber)" }}>· {report.unmatched} ⚠</span>
                  )}
                  {report.duplicate > 0 && (
                    <span style={{ color: "var(--rose)" }}>· {report.duplicate} dup</span>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="border-t pt-3 space-y-1" style={{ borderColor: "var(--border)" }}>
        <button onClick={get().applyToAll} className="cap-btn-secondary w-full text-[10px]">
          <Copy size={12} /> Aplicar capas a todos
        </button>
        <button
          onClick={() => get().setShowTableEditor(true)}
          className="cap-btn-secondary w-full text-[10px]"
        >
          <Table2 size={12} /> Editor de tabla
        </button>
        <button
          onClick={() => get().setTemplate(selectedIdx)}
          className="cap-btn-secondary w-full text-[10px] !text-purple-400"
        >
          Marcar como plantilla
        </button>
      </div>
    </div>
  );
}
