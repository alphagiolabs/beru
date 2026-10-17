import { useEffect, useRef, useState } from "react";
import useEditorStore from "../../stores/useEditorStore.js";
import { buildExportJob } from "../../utils/export-pipeline.js";
import { createJobSignatureCache, stampJobTimestamp } from "../../utils/job-signature.js";
import { normalizeTiming } from "../../../shared/clip-timeline.js";
import { createPreviewRequests } from "../../utils/preview-requests.js";

export function useCompositionPreview({ open, document, entry, onError }) {
  const get = useEditorStore.getState;
  const videoRef = useRef(null);
  const [requests] = useState(createPreviewRequests);
  const [signatureFor] = useState(createJobSignatureCache);
  const [frame, setFrame] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    requests.invalidate();
    setFrame(null);
    setBusy(false);
    return () => {
      requests.invalidate();
    };
  }, [open, document, entry?.id, requests]);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = normalizeTiming(entry?.item?.timing).rate;
      videoRef.current.preservesPitch = true;
    }
  }, [entry?.item, frame]);
  const clear = () => {
    requests.invalidate();
    setFrame(null);
    setBusy(false);
  };
  const preview = async () => {
    const timestamp = videoRef.current?.currentTime || 0;
    const job = () =>
      stampJobTimestamp(
        buildExportJob(entry.item, 0, { outputPath: null, encodeProfile: get().encodeProfile }),
        timestamp,
      );
    const signature = () =>
      signatureFor([entry.id, entry.item, get().encodeProfile], timestamp, job);
    const request = requests.begin(
      { document, timestamp, signature: signature() },
      (owner) =>
        !get().showCompositionModal ||
        get().isProcessing ||
        get().composition !== owner.document ||
        videoRef.current?.currentTime !== owner.timestamp ||
        signature() !== owner.signature,
    );
    setBusy(true);
    try {
      const response = await window.api.renderPreviewFrame(job());
      if (!request.isCurrent()) return;
      if (response?.ok) setFrame(response.data_url);
      else if (!response?.cancelled) onError();
    } catch {
      if (request.isCurrent()) onError();
    } finally {
      if (request.finish()) setBusy(false);
    }
  };
  return { videoRef, frame, busy, preview, clear };
}
