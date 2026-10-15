import { useCallback, useEffect, useRef, useState } from "react";
import { newEditorId } from "../../../../shared/editor-project.js";
import { projectDurationUs } from "../../../../shared/editor-timeline.js";
import { buildExactFrameManifest } from "../composition.js";
import { useTimelineStore } from "../store/useTimelineStore.js";

export default function useExactFrame(api) {
  const [frame, setFrame] = useState(null);
  const pending = useRef(null);
  const cancellation = useRef(null);

  const cancelPending = useCallback(() => {
    const attempt = pending.current;
    pending.current = null;
    if (attempt?.rendering) {
      cancellation.current = api.cancelEditorExport({ kind: "frame" }).catch(() => {});
    }
  }, [api]);

  useEffect(() => cancelPending, [cancelPending]);

  const close = useCallback(() => {
    cancelPending();
    setFrame(null);
  }, [cancelPending]);

  const request = useCallback(
    async (timeUs) => {
      cancelPending();
      const { history, revision } = useTimelineStore.getState();
      const attempt = { project: history.present, revision, rendering: false };
      const requestId = newEditorId("frame");
      pending.current = attempt;
      setFrame({ status: "busy", requestId });

      try {
        await cancellation.current;
        if (pending.current !== attempt) return;
        const endUs = projectDurationUs(attempt.project);
        const atUs = Math.max(0, Math.min(timeUs, endUs - 1));
        const manifest = buildExactFrameManifest(attempt.project, atUs, {
          audio: "original",
          encodeProfile: "fast",
        });
        attempt.rendering = true;
        const result = await api.renderEditorExactFrame({ manifest, requestId });
        if (pending.current !== attempt) return;
        pending.current = null;

        if (!result?.success) {
          setFrame({ status: "error", error: result?.error ?? "" });
          return;
        }
        const current = useTimelineStore.getState();
        if (current.revision !== attempt.revision || current.history.present !== attempt.project) {
          setFrame({ status: "stale", requestId });
          return;
        }
        setFrame({ status: "ready", requestId: result.requestId, path: result.path });
      } catch (error) {
        if (pending.current !== attempt) return;
        pending.current = null;
        setFrame({ status: "error", error: error.message });
      }
    },
    [api, cancelPending],
  );

  return { frame, request, close };
}
