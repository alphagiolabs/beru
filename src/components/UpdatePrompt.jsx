import { useEffect, useState } from "react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { formatUpdateError } from "../utils/updateErrors";
import UpdateModal from "./status-footer/UpdateModal";

export default function UpdatePrompt() {
  const t = useT();
  const get = useEditorStore.getState;
  const showToast = useEditorStore((s) => s.showToast);
  const update = useEditorStore((s) => s.update);
  const authStatus = useEditorStore((s) => s.authStatus);
  const updateModalOpen = useEditorStore((s) => s.updateModalOpen);
  const setUpdateModalOpen = useEditorStore((s) => s.setUpdateModalOpen);

  const [isStartingDownload, setIsStartingDownload] = useState(false);

  const updateStatus = update?.status || "idle";
  const hasUpdateBadge =
    updateStatus === "available" || updateStatus === "downloading" || updateStatus === "ready";
  const showLogin = isSupabaseConfigured && authStatus !== "authenticated";

  useEffect(() => {
    if ((updateStatus === "ready" || updateStatus === "downloading") && update?.version) {
      setUpdateModalOpen(true);
    }
  }, [updateStatus, update?.version, setUpdateModalOpen]);

  useEffect(() => {
    if (showLogin && updateStatus === "available" && update?.version) {
      setUpdateModalOpen(true);
    }
  }, [showLogin, updateStatus, update?.version, setUpdateModalOpen]);

  const handleUpdateNow = async () => {
    setUpdateModalOpen(true);
    setIsStartingDownload(true);
    useEditorStore.setState((s) => ({
      update: { ...s.update, error: null },
    }));

    try {
      const res = await get().downloadUpdate();
      if (res?.ok === false) {
        const message = formatUpdateError(t, res.reason || res.error);
        showToast({ kind: "err", text: message });
      }
    } finally {
      setIsStartingDownload(false);
    }
  };

  const handleUpdateLater = () => {
    setUpdateModalOpen(false);
  };

  const handleInstall = async () => {
    const res = await get().installUpdate();
    if (res?.ok === false) {
      showToast({ kind: "err", text: t("header.updateDownloadFailed") });
    }
  };

  const handleClose = () => {
    setUpdateModalOpen(false);
  };

  if (!updateModalOpen || !hasUpdateBadge) return null;

  return (
    <UpdateModal
      update={update}
      isStartingDownload={isStartingDownload}
      onUpdateNow={handleUpdateNow}
      onLater={handleUpdateLater}
      onInstall={handleInstall}
      onClose={handleClose}
      t={t}
    />
  );
}
