import { useEffect, useRef, useState } from "react";
import useEditorStore from "../../stores/useEditorStore.js";
import { buildExportJob } from "../../utils/export-pipeline.js";
import { createJobSignatureCache, stampJobTimestamp } from "../../utils/job-signature.js";
import { normalizeTiming } from "../../../shared/clip-timeline.js";

export function useCompositionPreview({ open, document, entry, onError }) {
  const get = useEditorStore.getState;
  const videoRef = useRef(null),
    sequence = useRef(0);
  const [signatureFor] = useState(createJobSignatureCache);
  const [frame, setFrame] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    sequence.current += 1;
    setFrame(null);
    setBusy(false);
    return () => {
      sequence.current += 1;
    };
  }, [open, document, entry?.id]);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = normalizeTiming(entry?.item?.timing).rate;
      videoRef.current.preservesPitch = true;
    }
  }, [entry?.item, frame]);
  const clear = () => {
    sequence.current += 1;
    setFrame(null);
    setBusy(false);
  };
  const preview = async () => {
    const token = ++sequence.current,
      owner = document,
      timestamp = videoRef.current?.currentTime || 0;
    const job = () =>
      stampJobTimestamp(
        buildExportJob(entry.item, 0, { outputPath: null, encodeProfile: get().encodeProfile }),
        timestamp,
      );
    const signature = () =>
      signatureFor([entry.id, entry.item, get().encodeProfile], timestamp, job);
    const requested = signature();
    const current = () =>
      token === sequence.current &&
      get().showCompositionModal &&
      !get().isProcessing &&
      get().composition === owner &&
      videoRef.current?.currentTime === timestamp &&
      signature() === requested;
    setBusy(true);
    try {
      const response = await window.api.renderPreviewFrame(job());
      if (!current()) return;
      if (response?.ok) setFrame(response.data_url);
      else if (!response?.cancelled) onError();
    } catch {
      if (current()) onError();
    } finally {
      if (token === sequence.current) setBusy(false);
    }
  };
  return { videoRef, frame, busy, preview, clear };
}
