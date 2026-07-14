import { memo, useMemo } from "react";
import useEditorStore from "../../stores/useEditorStore";
import { findTextOpForRegion } from "../../utils/text-style";
import { useT } from "../../i18n/useT";

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
function usePrecomputedCells(
  queue,
  templateRegions,
  excelMapping,
  excelRows,
  excelRowIndexByFilename,
) {
  return useMemo(() => {
    const get = useEditorStore.getState;
    const rowCount = queue.length;
    const colCount = templateRegions.length;
    const displayIds = new Array(rowCount);
    const cellText = new Array(rowCount);
    const hasOpText = new Array(rowCount);

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
    const t = useT();

    return (
      <tr
        onClick={() => setFocused((f) => ({ ...f, videoIdx: idx }))}
        className={isFocusedRow ? "is-row-focused" : undefined}
        data-row-focused={isFocusedRow ? "true" : undefined}
      >
        <td className="table-editor-idx">{idx + 1}</td>
        <td className="table-editor-filename" title={item.filename}>
          {item.filename}
        </td>
        <td
          className="table-editor-id"
          title={matchStatus === "matched" ? t("table.excelLinked") : matchStatus || ""}
        >
          {displayId}
          {matchStatus === "unmatched" && excelPath && (
            <span className="table-editor-unmatched" title={t("table.excelUnmatched")}>
              !
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
              className={isCellFocused ? "is-cell-focused" : undefined}
              data-cell-focused={isCellFocused ? "true" : undefined}
              style={
                isCellFocused
                  ? {
                      // Keep "2px solid" for keyboard navigation tests
                      borderLeft: "2px solid var(--purple)",
                      background: "rgba(168,85,247,0.08)",
                    }
                  : undefined
              }
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
                  className="table-editor-cell-input"
                />
              ) : cellText ? (
                <div
                  className={`table-editor-cell${fromExcelOnly ? " table-editor-cell--excel" : ""}`}
                  title={fromExcelOnly ? t("table.fromExcel") : undefined}
                >
                  {cellText}
                </div>
              ) : (
                <div className="table-editor-cell table-editor-cell--empty">+</div>
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
  const t = useT();
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
      className="table-editor-grid"
      role="grid"
      aria-label={t("table.gridAria")}
    >
      {!hasRegions ? (
        <div className="table-editor-grid-empty">{t("table.plainTextHint")}</div>
      ) : (
        <table className="table-editor-table">
          <thead>
            <tr>
              <th className="w-[40px]">#</th>
              <th>{t("table.colVideo")}</th>
              <th className="w-[80px]">ID</th>
              {templateRegions.map((tr) => {
                const excelCol = excelMapping.columns?.[tr.id];
                const colFocused = focused.regionId === tr.id;
                return (
                  <th
                    key={tr.id}
                    className={colFocused ? "is-col-focused" : undefined}
                    onClick={() => setFocused((f) => ({ ...f, regionId: tr.id }))}
                    title={excelCol ? t("table.excelCol", { col: excelCol }) : t("table.noExcelCol")}
                    style={
                      colFocused
                        ? {
                            // Keep "2px solid" for keyboard navigation tests
                            borderLeft: "2px solid var(--purple)",
                          }
                        : undefined
                    }
                  >
                    <div>{tr.label}</div>
                    {excelCol && <span className="table-editor-th-excel">→ {excelCol}</span>}
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
