import { createOperation } from "./operation.js";
import { normalizeMatchId, rowGet } from "./video-utils.js";
import {
  findTextOpForRegion,
  getGlobalTextStyleFromState,
  mergeTextStyles,
  pickTextStyle,
  textOpMatchesRegion,
} from "./text-style.js";

function matchExcel(queue, rows, idColumn) {
  const byId = new Map();
  const status = {};
  const report = { matched: 0, unmatched: 0, duplicate: 0, total: queue.length };
  if (!idColumn || !rows.length) {
    report.unmatched = queue.length;
    return { byId, status, report };
  }
  const duplicates = new Set();
  rows.forEach((row, index) => {
    const raw = rowGet(row, idColumn);
    if (raw == null || raw === "") return;
    const key = normalizeMatchId(raw);
    if (byId.has(key)) duplicates.add(key);
    else byId.set(key, index);
  });
  queue.forEach((item, index) => {
    const id = normalizeMatchId(item.filename);
    const kind = !byId.has(id) ? "unmatched" : duplicates.has(id) ? "duplicate" : "matched";
    status[index] = kind;
    report[kind]++;
  });
  return { byId, status, report };
}

function textOpsEqual(previous, next) {
  if (previous.length !== next.length) return false;
  return next.every((op, index) => {
    const old = previous[index];
    if (!old || old.mode !== op.mode) return false;
    if (op.mode !== "text") return old === op || old.id === op.id;
    return ["text", "batchRegionId", "fontSize", "fontColor", "fontFamily", "fontWeight"].every(
      (key) => (old[key] ?? null) === (op[key] ?? null),
    );
  });
}

export function removeLinkedTemplateText(operations, templateRegions) {
  return operations.filter(
    (op) =>
      op.mode !== "text" ||
      op.batchRegionId == null ||
      !templateRegions.some((tr) => textOpMatchesRegion(op, tr.region, tr.id)),
  );
}

function applyExcelText(state, match, preserveManual) {
  if (!state.excelMapping.idColumn || !state.excelRows.length) return state.queue;
  const globalStyle = getGlobalTextStyleFromState(state);
  let changed = false;
  const queue = state.queue.map((item, index) => {
    let operations = item.operations;
    if (match.status[index] === "matched") {
      const row = state.excelRows[match.byId.get(normalizeMatchId(item.filename))];
      const linked = preserveManual
        ? item.operations.filter((op) => op.mode !== "text" || op.batchRegionId != null)
        : item.operations;
      const preserved = preserveManual
        ? removeLinkedTemplateText(item.operations, state.templateRegions)
        : item.operations.filter(
            (op) =>
              op.mode !== "text" ||
              !state.templateRegions.some(
                (tr) => tr.region && textOpMatchesRegion(op, tr.region, tr.id),
              ),
          );
      const text = state.templateRegions.map((tr) => {
        const { op } = findTextOpForRegion(linked, tr.region, tr.id);
        const column = state.excelMapping.columns?.[tr.id];
        const value = column ? rowGet(row, column) : undefined;
        return createOperation({
          mode: "text",
          batchRegionId: tr.id,
          region: { ...(op?.region || tr.region) },
          text: value != null ? String(value) : "",
          ...pickTextStyle(op || mergeTextStyles(globalStyle, tr.style)),
        });
      });
      operations = [...preserved, ...text];
    }
    if (
      item.status === "idle" &&
      item.progress === 0 &&
      !item.error &&
      textOpsEqual(item.operations, operations)
    )
      return item;
    changed = true;
    return { ...item, operations, status: "idle", progress: 0, error: null };
  });
  return changed ? queue : state.queue;
}

export function reconcileBatchExport(
  state,
  changes = {},
  { applyExcel = false, preserveManual = false } = {},
) {
  const next = { ...state, ...changes };
  const queue = next.queue || [];
  const rows = next.excelRows || [];
  const mapping = next.excelMapping || { idColumn: null, columns: {} };
  const match = matchExcel(queue, rows, mapping.idColumn);
  return {
    patch: {
      ...changes,
      queue: applyExcel
        ? applyExcelText(
            {
              ...next,
              queue,
              excelRows: rows,
              excelMapping: mapping,
              templateRegions: next.templateRegions || [],
            },
            match,
            preserveManual,
          )
        : queue,
      excelRowIndexByFilename: Object.fromEntries([...match.byId].filter(([id]) => id)),
      excelMatchStatus: match.status,
      _excelRowIndexSource: rows,
      _excelRowIndexIdColumn: mapping.idColumn,
    },
    report: match.report,
  };
}

function hasCurrentIndex(state) {
  return (
    state._excelRowIndexSource === state.excelRows &&
    state._excelRowIndexIdColumn === state.excelMapping.idColumn
  );
}

export function batchExcelRowIndex(state, videoIdx) {
  const { queue, excelMapping, excelRows } = state;
  if (
    !excelMapping.idColumn ||
    !Number.isInteger(videoIdx) ||
    videoIdx < 0 ||
    videoIdx >= queue.length
  )
    return -1;
  const id = normalizeMatchId(queue[videoIdx].filename);
  if (hasCurrentIndex(state) && id !== "") {
    return Object.hasOwn(state.excelRowIndexByFilename, id)
      ? state.excelRowIndexByFilename[id]
      : -1;
  }
  return excelRows.findIndex((row) => {
    const value = rowGet(row, excelMapping.idColumn);
    return value != null && normalizeMatchId(value) === id;
  });
}

function updateRows(state, rows, idChanged) {
  if (!idChanged && hasCurrentIndex(state)) return { excelRows: rows, _excelRowIndexSource: rows };
  return reconcileBatchExport(state, { excelRows: rows }).patch;
}

export function syncBatchTextToExcel(state, videoIdx, regionId, text, changes = {}) {
  const next = { ...state, ...changes };
  const column = next.excelMapping.columns?.[regionId];
  if (!column) return changes;
  const rowIdx = batchExcelRowIndex(next, videoIdx);
  if (rowIdx < 0) return changes;
  const current = rowGet(next.excelRows[rowIdx], column);
  if (String(current ?? "") === String(text ?? "")) return changes;
  const rows = next.excelRows.map((row, index) =>
    index === rowIdx ? { ...row, [column]: text } : row,
  );
  return { ...changes, ...updateRows(next, rows, column === next.excelMapping.idColumn) };
}

export function syncBatchOperationsToExcel(state) {
  const { queue, templateRegions, excelMapping, excelRows } = state;
  if (!excelMapping.idColumn || !excelRows.length || !templateRegions.length) return {};
  const { patch } = reconcileBatchExport(state);
  const rows = excelRows.map((row) => ({ ...row }));
  let changed = false;
  let idChanged = false;
  for (const item of queue) {
    const id = normalizeMatchId(item.filename);
    if (!Object.hasOwn(patch.excelRowIndexByFilename, id)) continue;
    const rowIdx = patch.excelRowIndexByFilename[id];
    for (const tr of templateRegions) {
      const column = excelMapping.columns?.[tr.id];
      if (!column) continue;
      const { op } = findTextOpForRegion(item.operations, tr.region, tr.id);
      const text = op?.text ?? "";
      if (String(rows[rowIdx][column] ?? "") === text) continue;
      rows[rowIdx][column] = text;
      changed = true;
      if (column === excelMapping.idColumn) idChanged = true;
    }
  }
  return changed ? updateRows(state, rows, idChanged) : {};
}
