import { memo, useMemo } from "react";
import useEditorStore from "../../stores/useEditorStore";
import { findTextOpForRegion } from "../../utils/text-style";

/**
 * Precompute the per-row, per-region cell text and derived flags once per
 * relevant state change, instead of calling `get().getCellTextForRegion` /
 * `findTextOpForRegion` / `get().getExcelDisplayId` per cell per render.
 *
 * Returns:
 *  - displayIds: string[]                     (one per queue row)
 *  - cellText:   string[][]                   (row -> region col text)
 *  - hasOpText:  boolean[][]                  (row -> region col has op.text)
 */
function usePrecomputedCells(queue, templateRegions, excelMapping, excelRows, excelRowIndexByFilename) {
  return useMemo(() => {
    const get = useEditorStore.getState;
    const rowCount = queue.length;
    const colCount = templateRegions.length;
    const displayIds = new Array(rowCount);
    const cellText = new Array(rowCount);
    const hasOpText = new Array(rowCount);

    // Cache region lookups by id to avoid a linear `find` per cell.
    const regionById = new Map();
    for (let c = 0; c < colCount; c++) regionById.set(templateRegions[c].id, templateRegions[c]);

    for (let r = 0; r < rowCount; r++) {
      const item = queue[r];
      displayIds[r] = get().getExcelDisplayId(r);
      const cols = new Array(colCount);
      const opFlags = new Array(colCount);
      for (let c = 0; c < colCount; c++) {
        const tr = templateRegions[c];
        const { op } = findTextOpForRegion(item.operations, tr.region, tr.id);
        opFlags[c] = Boolean(op?.text);
        cols[c] = get().getCellTextForRegion(r, tr.id);
      }
      cellText[r] = cols;
      hasOpText[r] = opFlags;
    }
    return { displayIds, cellText, hasOpText };
    // excelRows / excelRowIndexByFilename drive getCellTextForRegion output;
    // queue/templateRegions/excelMapping drive both. `excelMapping` is an object
    // compared by ref (the store replaces it on change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, templateRegions, excelMapping, excelRows, excelRowIndexByFilename]);
}

const TableRow = memo(
  function TableRow({
    item,
    idx,
    cols,
    opFlags,
    displayId,
    matchStatus,
    excelPath,
    templateRegions,
    excelMapping,
    isFocusedRow,
    focusedRegionId,
    editingCell,
    editValue,
    setFocused,
    setEditValue,
    startInlineEdit,
    commitInlineEdit,
    cancelInlineEdit,
  }) {
    return (
      <tr
        onClick={() => setFocused((f) => ({ ...f, videoIdx: idx }))}
        className="cursor-pointer"
        style={{
          background: isFocusedRow ? "rgba(168,85,247,0.05)" : "transparent",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <td
          className="p-2 text-center font-mono"
          style={{ color: isFocusedRow ? "var(--purple)" : "var(--text-dim)" }}
        >
          {idx + 1}
        </td>
        <td
          className="p-2 font-medium"
          style={{
            color: isFocusedRow ? "var(--text-primary)" : "var(--text-secondary)",
          }}
          title={item.filename}
        >
          {item.filename}
        </td>
        <td
          className="p-2 font-mono text-[10px]"
          style={{ color: "var(--text-dim)" }}
          title={matchStatus === "matched" ? "Vinculado a Excel" : matchStatus || ""}
        >
          {displayId}
          {matchStatus === "unmatched" && excelPath && (
            <span className="ml-1 text-[9px]" style={{ color: "var(--amber)" }} title="Sin fila en Excel">
              ⚠
            </span>
          )}
        </td>
        {templateRegions.map((tr, c) => {
          const cellText = cols[c];
          const fromExcelOnly = !opFlags[c] && !!cellText && excelMapping.columns?.[tr.id];
          const isCellFocused = isFocusedRow && focusedRegionId === tr.id;
          const isEditing =
            editingCell && editingCell.videoIdx === idx && editingCell.regionId === tr.id;
          return (
            <td
              key={tr.id}
              onClick={(e) => {
                e.stopPropagation();
                setFocused({ videoIdx: idx, regionId: tr.id });
              }}
              onDoubleClick={() => startInlineEdit(idx, tr.id, cellText)}
              className="p-1 align-top"
              style={{
                borderLeft: isCellFocused ? "2px solid var(--purple)" : "none",
                background: isCellFocused ? "rgba(168,85,247,0.08)" : "transparent",
              }}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitInlineEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitInlineEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelInlineEdit();
                    }
                    e.stopPropagation();
                  }}
                  className="w-full px-1.5 py-0.5 rounded text-[11px] outline-none"
                  style={{
                    background: "var(--bg-app)",
                    border: "1px solid var(--purple)",
                    color: "var(--text-primary)",
                  }}
                />
              ) : cellText ? (
                <div
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    color: fromExcelOnly ? "var(--text-secondary)" : "var(--text-primary)",
                    fontStyle: fromExcelOnly ? "italic" : "normal",
                  }}
                  title={
                    fromExcelOnly ? "Valor desde Excel (doble clic para editar)" : undefined
                  }
                >
                  {cellText}
                </div>
              ) : (
                <div
                  className="px-1.5 py-0.5 rounded text-center text-[10px] italic"
                  style={{ color: "var(--text-dim)" }}
                >
                  +
                </div>
              )}
            </td>
          );
        })}
      </tr>
    );
  },
  (prev, next) => {
    return (
      prev.item === next.item &&
      prev.idx === next.idx &&
      prev.cols === next.cols &&
      prev.opFlags === next.opFlags &&
      prev.displayId === next.displayId &&
      prev.matchStatus === next.matchStatus &&
      prev.excelPath === next.excelPath &&
      prev.templateRegions === next.templateRegions &&
      prev.excelMapping === next.excelMapping &&
      prev.isFocusedRow === next.isFocusedRow &&
      prev.focusedRegionId === next.focusedRegionId &&
      prev.editingCell === next.editingCell &&
      prev.editValue === next.editValue &&
      prev.setFocused === next.setFocused &&
      prev.setEditValue === next.setEditValue &&
      prev.startInlineEdit === next.startInlineEdit &&
      prev.commitInlineEdit === next.commitInlineEdit &&
      prev.cancelInlineEdit === next.cancelInlineEdit
    );
  },
);

export default function TableEditorGrid({
  tableRef,
  hasRegions,
  queue,
  templateRegions,
  excelPath,
  excelMapping,
  excelMatchStatus,
  focused,
  setFocused,
  editingCell,
  editValue,
  setEditValue,
  startInlineEdit,
  commitInlineEdit,
  cancelInlineEdit,
  handleTableKey,
}) {
  // Subscribe to the Excel state that drives getCellTextForRegion / getExcelDisplayId
  // so the precompute memo invalidates when they change (the previous code read
  // these via getState() per cell per render and never re-rendered on change).
  const excelRows = useEditorStore((s) => s.excelRows);
  const excelRowIndexByFilename = useEditorStore((s) => s.excelRowIndexByFilename);

  const { displayIds, cellText, hasOpText } = usePrecomputedCells(
    queue,
    templateRegions,
    excelMapping,
    excelRows,
    excelRowIndexByFilename,
  );

  return (
    <div
      ref={tableRef}
      tabIndex={0}
      onKeyDown={handleTableKey}
      className="flex-1 overflow-auto focus:outline-none"
      style={{ minHeight: "180px", maxHeight: "40vh" }}
    >
      {!hasRegions ? (
        <div className="p-6 text-center text-[11px]" style={{ color: "var(--text-dim)" }}>
          Tabla de texto plano: muestra todas las operaciones de texto del video.
        </div>
      ) : (
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr>
              <th
                className="text-left p-2 sticky top-0 z-10 w-[40px]"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-dim)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                #
              </th>
              <th
                className="text-left p-2 sticky top-0 z-10"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-dim)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                Video
              </th>
              <th
                className="text-left p-2 sticky top-0 z-10 w-[80px]"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-dim)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                ID
              </th>
              {templateRegions.map((tr) => {
                const excelCol = excelMapping.columns?.[tr.id];
                return (
                  <th
                    key={tr.id}
                    className="text-left p-2 sticky top-0 z-10 cursor-pointer"
                    style={{
                      background:
                        focused.regionId === tr.id ? "rgba(168,85,247,0.15)" : "var(--bg-elevated)",
                      color: focused.regionId === tr.id ? "var(--purple)" : "var(--purple)",
                      borderBottom: "1px solid var(--border)",
                      borderLeft: focused.regionId === tr.id ? "2px solid var(--purple)" : "none",
                    }}
                    onClick={() => setFocused((f) => ({ ...f, regionId: tr.id }))}
                    title={excelCol ? `Columna Excel: ${excelCol}` : "Sin columna Excel mapeada"}
                  >
                    <div>{tr.label}</div>
                    {excelCol && (
                      <div
                        className="text-[9px] font-mono font-normal truncate max-w-[120px]"
                        style={{ color: "var(--text-dim)" }}
                      >
                        → {excelCol}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {queue.map((item, idx) => {
              const isEditingThis =
                editingCell && editingCell.videoIdx === idx && editingCell.regionId != null;
              return (
                <TableRow
                  key={idx}
                  item={item}
                  idx={idx}
                  cols={cellText[idx]}
                  opFlags={hasOpText[idx]}
                  displayId={displayIds[idx]}
                  matchStatus={excelMatchStatus[idx]}
                  excelPath={excelPath}
                  templateRegions={templateRegions}
                  excelMapping={excelMapping}
                  isFocusedRow={focused.videoIdx === idx}
                  focusedRegionId={focused.regionId}
                  editingCell={isEditingThis ? editingCell : null}
                  editValue={isEditingThis ? editValue : ""}
                  setFocused={setFocused}
                  setEditValue={setEditValue}
                  startInlineEdit={startInlineEdit}
                  commitInlineEdit={commitInlineEdit}
                  cancelInlineEdit={cancelInlineEdit}
                />
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
