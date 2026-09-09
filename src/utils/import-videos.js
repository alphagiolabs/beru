export async function importVideosFromDialog({ api, store, t, busy = false }) {
  if (busy) {
    store.showToast({ kind: "warn", text: t("queue.processingBusy") });
    return;
  }
  if (!api?.openVideos) {
    store.showToast({ kind: "err", text: t("errors.noApi") });
    return;
  }
  try {
    const paths = await api.openVideos();
    if (!paths?.length) return;
    await store.addVideos(paths, api);
    store.showToast({ kind: "ok", text: t("drop.added", { count: paths.length }) });
  } catch (err) {
    console.error("[beru] Video import failed:", err);
    store.showToast({
      kind: "err",
      text: t("errors.importVideosFailed", {
        message: err?.message || t("errors.unknown"),
      }),
    });
  }
}
