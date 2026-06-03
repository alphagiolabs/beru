import useEditorStore from "../../stores/useEditorStore";
import { findTextOpForRegion } from "../../utils/text-style";

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
  const get = useEditorStore.getState;

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
              const id = get().getExcelDisplayId(idx);
              const matchStatus = excelMatchStatus[idx];
              const isFocusedRow = focused.videoIdx === idx;
              return (
                <tr
                  key={idx}
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
                    {id}
                    {matchStatus === "unmatched" && excelPath && (
                      <span
                        className="ml-1 text-[9px]"
                        style={{ color: "var(--amber)" }}
                        title="Sin fila en Excel"
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  {templateRegions.map((tr) => {
                    const { op } = findTextOpForRegion(item.operations, tr.region);
                    const cellText = get().getCellTextForRegion(idx, tr.id);
                    const fromExcelOnly = !op?.text && !!cellText && excelMapping.columns?.[tr.id];
                    const isCellFocused = focused.videoIdx === idx && focused.regionId === tr.id;
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
                              color: fromExcelOnly
                                ? "var(--text-secondary)"
                                : "var(--text-primary)",
                              fontStyle: fromExcelOnly ? "italic" : "normal",
                            }}
                            title={
                              fromExcelOnly
                                ? "Valor desde Excel (doble clic para editar)"
                                : undefined
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
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
