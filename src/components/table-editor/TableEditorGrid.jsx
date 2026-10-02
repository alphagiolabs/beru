import { memo, useCallback, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import useEditorStore from "../../stores/useEditorStore";
import { findTextOpForRegion } from "../../utils/text-style";
import { useT } from "../../i18n/useT";
import useOverlayScroll from "./useOverlayScroll";
import { PERF_FLAGS } from "../../utils/perf-flags.js";

const TableRow = memo(
  function TableRow({
    item,
    idx,
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
    const get = useEditorStore.getState;
    const displayId = get().getExcelDisplayId(idx);

    return (
      <tr
        onClick={() => setFocused((f) => ({ ...f, videoIdx: idx }))}
        className={isFocusedRow ? "is-row-focused" : undefined}
        data-row-focused={isFocusedRow ? "true" : undefined}
      >
        <td className="te-td-idx">{idx + 1}</td>
        <td className="te-td-file" title={item.filename}>
          {item.filename}
        </td>
        <td
          className="te-td-id"
          title={matchStatus === "matched" ? t("table.excelLinked") : matchStatus || ""}
        >
          {displayId}
          {matchStatus === "unmatched" && excelPath && (
            <span className="te-warn" title={t("table.excelUnmatched")}>
              !
            </span>
          )}
        </td>
        {templateRegions.map((tr) => {
          const { op } = findTextOpForRegion(item.operations, tr.region, tr.id);
          const cellText = get().getCellTextForRegion(idx, tr.id);
          const fromExcelOnly = !op?.text && !!cellText && excelMapping.columns?.[tr.id];
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
                  className="te-cell-input"
                />
              ) : cellText ? (
                <div
                  className={`te-cell${fromExcelOnly ? " te-cell--excel" : ""}`}
                  title={fromExcelOnly ? t("table.fromExcel") : undefined}
                >
                  {cellText}
                </div>
              ) : (
                <div className="te-cell te-cell--empty">+</div>
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
      prev.excelRow === next.excelRow &&
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
  const bindScroll = useOverlayScroll();
  const get = useEditorStore.getState;
  const excelRows = useEditorStore((s) => s.excelRows);
  useEditorStore((s) => s.excelRowIndexByFilename);

  const [gridEl, setGridEl] = useState(null);
  const setGridNode = useCallback(
    (node) => {
      setGridEl(node);
      bindScroll(node);
      if (!tableRef) return;
      if (typeof tableRef === "function") tableRef(node);
      else tableRef.current = node;
    },
    [bindScroll, tableRef],
  );

  const virtualize = PERF_FLAGS.virtualize && queue.length >= PERF_FLAGS.virtualizeThreshold;
  const colSpan = templateRegions.length + 3;
  const rowVirtualizer = useVirtualizer({
    count: virtualize ? queue.length : 0,
    getScrollElement: () => gridEl,
    estimateSize: () => 30,
    overscan: 10,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (!virtualize) return;
    rowVirtualizer.scrollToIndex(focused.videoIdx, { align: "auto" });
  }, [virtualize, focused.videoIdx, rowVirtualizer]);

  const renderRow = (idx) => {
    const item = queue[idx];
    const rowIdx = get().getExcelRowIndexForVideo(idx);
    const isEditingThis =
      editingCell && editingCell.videoIdx === idx && editingCell.regionId != null;
    return (
      <TableRow
        key={idx}
        item={item}
        idx={idx}
        excelRow={rowIdx >= 0 ? excelRows[rowIdx] : undefined}
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
  };

  return (
    <div
      ref={setGridNode}
      tabIndex={0}
      onKeyDown={handleTableKey}
      className="te-grid table-editor-scroll"
      role="grid"
      aria-label={t("table.gridAria")}
    >
      {!hasRegions ? (
        <div className="te-grid-empty">{t("table.plainTextHint")}</div>
      ) : (
        <table className="te-table">
          <thead>
            <tr>
              <th className="te-th-idx">#</th>
              <th>{t("table.colVideo")}</th>
              <th className="te-th-id">ID</th>
              {templateRegions.map((tr) => {
                const excelCol = excelMapping.columns?.[tr.id];
                const colFocused = focused.regionId === tr.id;
                return (
                  <th
                    key={tr.id}
                    className={colFocused ? "is-col-focused" : undefined}
                    onClick={() => setFocused((f) => ({ ...f, regionId: tr.id }))}
                    title={
                      excelCol ? t("table.excelCol", { col: excelCol }) : t("table.noExcelCol")
                    }
                    style={
                      colFocused
                        ? {
                            borderLeft: "2px solid var(--purple)",
                          }
                        : undefined
                    }
                  >
                    <span className="te-th-label">{tr.label}</span>
                    {excelCol ? <span className="te-th-excel">{excelCol}</span> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {virtualize ? (
              <>
                {virtualItems.length > 0 && virtualItems[0].start > 0 && (
                  <tr aria-hidden="true">
                    <td
                      colSpan={colSpan}
                      style={{ height: virtualItems[0].start, padding: 0, border: "none" }}
                    />
                  </tr>
                )}
                {virtualItems.map((vi) => renderRow(vi.index))}
                {virtualItems.length > 0 &&
                  rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={colSpan}
                        style={{
                          height:
                            rowVirtualizer.getTotalSize() -
                            virtualItems[virtualItems.length - 1].end,
                          padding: 0,
                          border: "none",
                        }}
                      />
                    </tr>
                  )}
              </>
            ) : (
              queue.map((_, idx) => renderRow(idx))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
