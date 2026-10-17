import { useCallback, useEffect, useRef, useState } from "react";
import { newEditorId } from "../../../../shared/editor-project.js";
import { projectDurationUs } from "../../../../shared/editor-timeline.js";
import { buildExactFrameManifest } from "../composition.js";
import { useTimelineStore } from "../store/useTimelineStore.js";
import { createPreviewRequests } from "../../../utils/preview-requests.js";

export default function useExactFrame(api) {
  const [frame, setFrame] = useState(null);
  const [requests] = useState(createPreviewRequests);
  const cancellation = useRef(null);

  const cancelPending = useCallback(() => {
    const attempt = requests.invalidate();
    if (attempt?.rendering) {
      cancellation.current = api.cancelEditorExport({ kind: "frame" }).catch(() => {});
    }
  }, [api, requests]);

  useEffect(() => cancelPending, [cancelPending]);

  const close = useCallback(() => {
    cancelPending();
    setFrame(null);
  }, [cancelPending]);

  const request = useCallback(
    async (timeUs) => {
      cancelPending();
      const { history, revision } = useTimelineStore.getState();
      const owner = { project: history.present, revision, rendering: false };
      const attempt = requests.begin(owner, (snapshot) => {
        const current = useTimelineStore.getState();
        return (
          current.revision !== snapshot.revision || current.history.present !== snapshot.project
        );
      });
      const requestId = newEditorId("frame");
      setFrame({ status: "busy", requestId });

      try {
        await cancellation.current;
        if (!attempt.isPending()) return;
        const endUs = projectDurationUs(owner.project);
        const atUs = Math.max(0, Math.min(timeUs, endUs - 1));
        const manifest = buildExactFrameManifest(owner.project, atUs, {
          audio: "original",
          encodeProfile: "fast",
        });
        owner.rendering = true;
        const result = await api.renderEditorExactFrame({ manifest, requestId });
        if (!attempt.isPending()) return;

        if (!result?.success) {
          setFrame({ status: "error", error: result?.error ?? "" });
          return;
        }
        if (!attempt.isCurrent()) {
          setFrame({ status: "stale", requestId });
          return;
        }
        setFrame({ status: "ready", requestId: result.requestId, path: result.path });
      } catch (error) {
        if (!attempt.isPending()) return;
        setFrame({ status: "error", error: error.message });
      } finally {
        attempt.finish();
      }
    },
    [api, cancelPending, requests],
  );

  return { frame, request, close };
}
