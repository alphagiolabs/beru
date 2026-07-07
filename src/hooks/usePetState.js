import { useEffect, useRef, useState } from "react";
import useEditorStore from "../stores/useEditorStore";
import {
  celebrationDurationMs,
  resolveBatchCelebration,
  resolvePetActivity,
} from "../utils/pet-activity.js";

function summarizeQueue(queue) {
  let succeeded = 0;
  let failed = 0;
  for (const item of queue) {
    if (item.status === "done") succeeded += 1;
    else if (item.status === "error") failed += 1;
  }
  const total = succeeded + failed;
  return total > 0 ? { total, succeeded, failed } : null;
}

export default function usePetState() {
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const confirmDialog = useEditorStore((s) => s.confirmDialog);
  const updateStatus = useEditorStore((s) => s.update.status);
  const batchSummary = useEditorStore((s) => s.batchSummary);
  const queue = useEditorStore((s) => s.queue);

  const [celebration, setCelebration] = useState(null);
  const wasProcessingRef = useRef(false);
  const celebrationTimerRef = useRef(null);

  useEffect(() => {
    if (isProcessing) {
      wasProcessingRef.current = true;
      if (celebrationTimerRef.current) {
        clearTimeout(celebrationTimerRef.current);
        celebrationTimerRef.current = null;
      }
      setCelebration(null);
      return undefined;
    }

    if (!wasProcessingRef.current) return undefined;
    wasProcessingRef.current = false;

    const summary = batchSummary || summarizeQueue(queue);
    const nextCelebration = resolveBatchCelebration(summary);
    if (!nextCelebration) return undefined;

    setCelebration(nextCelebration);
    celebrationTimerRef.current = setTimeout(() => {
      celebrationTimerRef.current = null;
      setCelebration(null);
    }, celebrationDurationMs(nextCelebration));

    return () => {
      if (celebrationTimerRef.current) {
        clearTimeout(celebrationTimerRef.current);
        celebrationTimerRef.current = null;
      }
    };
  }, [isProcessing, batchSummary, queue]);

  return resolvePetActivity({
    isProcessing,
    confirmOpen: !!confirmDialog,
    updateDownloading: updateStatus === "downloading",
    celebration,
  });
}
