import { useMemo, useState, useEffect } from "react";
import { X, FileSpreadsheet, ArrowRight, RotateCcw } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { stripExt, rowGet, normalizeMatchId } from "../utils/video-utils";
import { useT } from "../i18n/useT";

const PREVIEW_ROWS = 5;

export default function ExcelMappingModal() {
  const t = useT();
  const { showMappingModal, excelHeaders, excelRows, excelMapping, templateRegions, queue } =
    useEditorStore(
      (s) => ({
        showMappingModal: s.showMappingModal,
        excelHeaders: s.excelHeaders,
        excelRows: s.excelRows,
        excelMapping: s.excelMapping,
        templateRegions: s.templateRegions,
        queue: s.queue,
      }),
      shallow,
    );
  const [draft, setDraft] = useState(excelMapping);

  useEffect(() => {
    if (showMappingModal) setDraft(excelMapping);
  }, [showMappingModal, excelMapping]);

  const idCol = draft.idColumn || "";
  const sample = useMemo(() => excelRows.slice(0, PREVIEW_ROWS), [excelRows]);

  /* Build per-video preview: shows which text would be injected for each region. */
  const videoPreview = useMemo(() => {
    if (!idCol) return [];
    return queue.map((item) => {
      const id = normalizeMatchId(item.filename);
      const row = excelRows.find((r) => {
        const v = rowGet(r, idCol);
        return v !== undefined && v !== null && normalizeMatchId(v) === id;
      });
      return {
        filename: item.filename,
        id,
        found: !!row,
        values: templateRegions.map((tr) => {
          const col = draft.columns[tr.id];
          const val = row && col ? rowGet(row, col) : null;
          return {
            label: tr.label,
            value: val === undefined || val === null ? "" : String(val),
            mapped: !!col,
          };
        }),
      };
    });
  }, [queue, excelRows, idCol, draft.columns, templateRegions]);

  const matchedCount = videoPreview.filter((v) => v.found).length;
  const unmatchedCount = videoPreview.length - matchedCount;

  if (!showMappingModal) return null;

  const getState = useEditorStore.getState;

  const handleApply = () => {
    getState().updateExcelMapping(draft);
    getState().setShowMappingModal(false);
  };

  const handleReset = () => {
    const idAliases = [
      "id",
      "code",
      "codigo",
      "video",
      "archivo",
      "filename",
      "name",
      "nombre",
      "identificador",
    ];
    const idColumn =
      excelHeaders.find((h) => idAliases.includes(h.toLowerCase().trim())) ||
      excelHeaders[0] ||
      null;
    const columns = {};
    for (const tr of templateRegions) {
      const labelKey = tr.label.toLowerCase().trim();
      const match = excelHeaders.find((h) => h.toLowerCase().trim() === labelKey);
      if (match) columns[tr.id] = match;
    }
    setDraft({ idColumn, columns });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={() => getState().setShowMappingModal(false)}
    >
      <div
        className="w-[min(960px,95vw)] max-h-[90vh] flex flex-col rounded-lg shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} style={{ color: "var(--purple)" }} />
            <span className="text-sm font-semibold">{t("excel.title")}</span>
            <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
              {excelRows.length} filas · {excelHeaders.length} columnas · {templateRegions.length}{" "}
              regiones
            </span>
          </div>
          <button
            onClick={() => getState().setShowMappingModal(false)}
            className="p-1 rounded hover:bg-white/10"
            style={{ color: "var(--text-dim)" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ID column selector */}
          <div>
            <div className="cap-input-label mb-1">{t("excel.idColumn")}</div>
            <select
              value={idCol}
              onChange={(e) => setDraft((d) => ({ ...d, idColumn: e.target.value || null }))}
              className="cap-input text-[12px]"
            >
              <option value="">— Seleccionar columna —</option>
              {excelHeaders.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <div className="text-[10px] mt-1" style={{ color: "var(--text-dim)" }}>
              El ID se compara con el nombre del video sin extensión (case-insensitive, trim).
            </div>
          </div>

          {/* Region → column mapping */}
          <div>
            <div className="cap-input-label mb-1.5">{t("excel.regionColumn")}</div>
            {templateRegions.length === 0 ? (
              <div
                className="text-[11px] p-3 rounded"
                style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
              >
                No hay regiones de plantilla. Dibujá una región en el video y agrégala desde "Texto
                en lote" antes de mapear.
              </div>
            ) : (
              <div className="space-y-1.5">
                {templateRegions.map((tr) => (
                  <div
                    key={tr.id}
                    className="grid grid-cols-[110px_24px_1fr] items-center gap-2 p-2 rounded"
                    style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
                  >
                    <span
                      className="text-[11px] font-mono truncate"
                      style={{ color: "var(--purple)" }}
                    >
                      {tr.label}
                    </span>
                    <ArrowRight size={12} style={{ color: "var(--text-dim)" }} />
                    <select
                      value={draft.columns[tr.id] || ""}
                      onChange={(e) =>
                        setDraft((d) => {
                          const next = { ...d.columns };
                          if (e.target.value) next[tr.id] = e.target.value;
                          else delete next[tr.id];
                          return { ...d, columns: next };
                        })
                      }
                      className="cap-input text-[11px]"
                    >
                      <option value="">— No mapear —</option>
                      {excelHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="cap-input-label">{t("excel.preview")}</div>
              <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                {matchedCount} matcheados · {unmatchedCount} sin match
              </div>
            </div>
            <div className="rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <div className="overflow-x-auto max-h-[260px]">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0" style={{ background: "var(--bg-surface)" }}>
                    <tr>
                      <th
                        className="text-left p-1.5"
                        style={{
                          color: "var(--text-dim)",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        Video
                      </th>
                      <th
                        className="text-left p-1.5"
                        style={{
                          color: "var(--text-dim)",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        ID
                      </th>
                      {templateRegions.map((tr) => (
                        <th
                          key={tr.id}
                          className="text-left p-1.5"
                          style={{
                            color: "var(--purple)",
                            borderBottom: "1px solid var(--border)",
                            borderLeft: "1px solid var(--border)",
                          }}
                        >
                          {tr.label}
                          {draft.columns[tr.id] && (
                            <div
                              className="text-[8px] font-normal"
                              style={{ color: "var(--text-dim)" }}
                            >
                              ← {draft.columns[tr.id]}
                            </div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {videoPreview.slice(0, 20).map((v) => (
                      <tr key={v.filename} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td
                          className="p-1.5 truncate max-w-[180px]"
                          style={{ color: v.found ? "var(--text-primary)" : "var(--text-dim)" }}
                        >
                          {v.filename}
                        </td>
                        <td
                          className="p-1.5 font-mono"
                          style={{ color: v.found ? "var(--accent)" : "var(--rose)" }}
                        >
                          {v.id}
                        </td>
                        {v.values.map((vv, i) => (
                          <td
                            key={i}
                            className="p-1.5 truncate max-w-[160px]"
                            style={{
                              color: vv.mapped ? "var(--text-primary)" : "var(--text-dim)",
                              borderLeft: "1px solid var(--border)",
                            }}
                          >
                            {vv.value || (vv.mapped ? "—" : "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {videoPreview.length === 0 && (
                      <tr>
                        <td
                          colSpan={2 + templateRegions.length}
                          className="p-4 text-center"
                          style={{ color: "var(--text-dim)" }}
                        >
                          No hay videos en la cola
                        </td>
                      </tr>
                    )}
                    {videoPreview.length > 20 && (
                      <tr>
                        <td
                          colSpan={2 + templateRegions.length}
                          className="p-2 text-center text-[9px]"
                          style={{ color: "var(--text-dim)" }}
                        >
                          Mostrando 20 de {videoPreview.length} videos
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Excel sample */}
          <details>
            <summary className="text-[10px] cursor-pointer" style={{ color: "var(--text-dim)" }}>
              Ver primeras {PREVIEW_ROWS} filas del Excel
            </summary>
            <div
              className="mt-2 rounded overflow-x-auto"
              style={{ border: "1px solid var(--border)" }}
            >
              <table className="w-full text-[10px]">
                <thead style={{ background: "var(--bg-surface)" }}>
                  <tr>
                    {excelHeaders.map((h) => (
                      <th
                        key={h}
                        className="text-left p-1.5"
                        style={{
                          color: h === idCol ? "var(--accent)" : "var(--text-dim)",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sample.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      {excelHeaders.map((h) => (
                        <td
                          key={h}
                          className="p-1.5 truncate max-w-[140px]"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {String(row[h] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 border-t flex items-center justify-between flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <button onClick={handleReset} className="cap-btn-secondary text-[11px]">
            <RotateCcw size={12} /> Auto-detectar
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => getState().setShowMappingModal(false)}
              className="cap-btn-secondary text-[11px]"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleApply}
              disabled={!draft.idColumn}
              className="cap-btn-primary text-[11px]"
            >
              {t("excel.apply")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
