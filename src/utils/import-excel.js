import { textOpMatchesRegion } from "./text-style.js";
import { storeErrorText } from "./store-errors.js";

export async function importExcelFromDialog({ api, store, t, showToast }) {
  const hasLinkedTextToOverwrite = store.queue.some((v) =>
    v.operations.some(
      (op) =>
        op.mode === "text" &&
        store.templateRegions.some((tr) => tr.region && textOpMatchesRegion(op, tr.region, tr.id)),
    ),
  );
  if (hasLinkedTextToOverwrite) {
    const ok = await store.requestConfirm({ message: t("batch.confirmExcelOverwrite") });
    if (!ok) return { canceled: true };
  }

  const path = await api?.openExcel();
  if (!path) return { canceled: true };

  const result = await store.importExcel(path);
  if (!result.success) {
    showToast({
      kind: "err",
      text: t("batch.excelParseError", {
        message: storeErrorText(t, result, "errors.excelReadFailed"),
      }),
    });
    return { canceled: false, success: false };
  }

  const mapping = store.excelMapping;
  if (!mapping.idColumn || Object.keys(mapping.columns).length === 0) {
    store.setShowMappingModal(true);
  } else {
    showToast({
      kind: "ok",
      text: result.messageKey
        ? t(result.messageKey, result.messageVars)
        : t("batch.excelLinked", { count: result.rowCount ?? 0 }),
    });
  }
  return { canceled: false, success: true };
}
