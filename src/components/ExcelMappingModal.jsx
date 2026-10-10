import { useMemo, useState, useEffect } from "react";
import { X, FileSpreadsheet, ArrowRight, RotateCcw } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { rowGet, normalizeMatchId } from "../utils/video-utils";
import { ID_COLUMN_ALIASES } from "../utils/types";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import { Select } from "./ui/select";

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

  const rowIndexById = useMemo(() => {
    const map = new Map();
    if (!showMappingModal || !idCol) return map;
    for (let i = 0; i < excelRows.length; i++) {
      const v = rowGet(excelRows[i], idCol);
      if (v === undefined || v === null) continue;
      const key = normalizeMatchId(v);
      if (!map.has(key)) map.set(key, i);
    }
    return map;
  }, [excelRows, idCol, showMappingModal]);

  const videoPreview = useMemo(() => {
    if (!showMappingModal || !idCol) return [];
    return queue.map((item) => {
      const id = normalizeMatchId(item.filename);
      const rowIdx = rowIndexById.get(id);
      const row = rowIdx === undefined ? undefined : excelRows[rowIdx];
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
  }, [queue, excelRows, idCol, rowIndexById, draft.columns, templateRegions, showMappingModal]);

  const headerOptions = useMemo(
    () => excelHeaders.map((h) => ({ value: h, label: h })),
    [excelHeaders],
  );
  const matchedCount = videoPreview.filter((v) => v.found).length;
  const unmatchedCount = videoPreview.length - matchedCount;

  if (!showMappingModal) return null;

  const getState = useEditorStore.getState;

  const handleApply = () => {
    getState().updateExcelMapping(draft);
    getState().setShowMappingModal(false);
  };

  const handleReset = () => {
    const idColumn =
      excelHeaders.find((h) => ID_COLUMN_ALIASES.includes(h.toLowerCase().trim())) ||
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
    <div className="cap-modal-overlay" onClick={() => getState().setShowMappingModal(false)}>
      <div
        className="cap-modal-panel max-w-[960px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} style={{ color: "var(--text-purple)" }} />
            <span className="text-sm font-semibold">{t("excel.title")}</span>
            <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
              {t("excel.metaStats", {
                rows: excelRows.length,
                cols: excelHeaders.length,
                regions: templateRegions.length,
              })}
            </span>
          </div>
          <Button
            type="button"
            onClick={() => getState().setShowMappingModal(false)}
            variant="tertiary"
            size="icon"
            className="text-[var(--text-dim)] hover:bg-white/10"
            style={{ color: "var(--text-dim)" }}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <div className="cap-input-label mb-1">{t("excel.idColumn")}</div>
            <Select
              value={idCol}
              onValueChange={(v) => setDraft((d) => ({ ...d, idColumn: v || null }))}
              aria-label={t("excel.idColumn")}
              options={[{ value: "", label: t("excel.selectColumn") }, ...headerOptions]}
            />
            <div className="text-[10px] mt-1" style={{ color: "var(--text-dim)" }}>
              {t("excel.idHint")}
            </div>
          </div>

          <div>
            <div className="cap-input-label mb-1.5">{t("excel.regionColumn")}</div>
            {templateRegions.length === 0 ? (
              <div
                className="text-[11px] p-3 rounded"
                style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
              >
                {t("excel.noRegions")}
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
                      style={{ color: "var(--text-purple)" }}
                    >
                      {tr.label}
                    </span>
                    <ArrowRight size={12} style={{ color: "var(--text-dim)" }} />
                    <Select
                      size="sm"
                      value={draft.columns[tr.id] || ""}
                      onValueChange={(v) =>
                        setDraft((d) => {
                          const next = { ...d.columns };
                          if (v) next[tr.id] = v;
                          else delete next[tr.id];
                          return { ...d, columns: next };
                        })
                      }
                      aria-label={tr.label}
                      options={[{ value: "", label: t("excel.noMap") }, ...headerOptions]}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="cap-input-label">{t("excel.preview")}</div>
              <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                {t("excel.matchSummary", { matched: matchedCount, unmatched: unmatchedCount })}
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
                        {t("props.video")}
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
                            color: "var(--text-purple)",
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
                          style={{ color: v.found ? "var(--text-accent)" : "var(--text-rose)" }}
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
                            {vv.value || "—"}
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
                          {t("excel.queueEmpty")}
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
                          {t("excel.showingSubset", { shown: 20, total: videoPreview.length })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <details>
            <summary className="text-[10px] cursor-pointer" style={{ color: "var(--text-dim)" }}>
              {t("excel.showFirstRows", { count: PREVIEW_ROWS })}
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
                          color: h === idCol ? "var(--text-accent)" : "var(--text-dim)",
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

        <div
          className="px-4 py-3 border-t flex items-center justify-between flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <Button type="button" onClick={handleReset} variant="secondary" size="sm">
            <RotateCcw size={12} /> {t("excel.autoDetect")}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => getState().setShowMappingModal(false)}
              variant="secondary"
              size="sm"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={!draft.idColumn}
              variant="primary"
              size="sm"
            >
              {t("excel.apply")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
