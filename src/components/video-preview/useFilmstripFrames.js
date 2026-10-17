import { useEffect, useState } from "react";
import { createPreviewRequests } from "../../utils/preview-requests.js";

const FRAME_HEIGHT = 64;
const EMPTY = { frames: [], aspect: 16 / 9 };

export default function useFilmstripFrames(path, duration, count = 20, { start = 0, owner } = {}) {
  const source = JSON.stringify([path, duration, count, start]);
  const [state, setState] = useState(EMPTY);
  const [requests] = useState(createPreviewRequests);

  useEffect(() => {
    setState({ ...EMPTY, source });
    if (!path || !(duration > 0) || typeof window.api?.getFilmstrip !== "function") return;

    const requestId = crypto.randomUUID();
    const request = requests.begin({ requestId });
    const unsubscribe = window.api.onFilmstripProgress?.((progress) => {
      if (
        !request.isCurrent() ||
        progress?.requestId !== requestId ||
        !Number.isInteger(progress.index) ||
        !Number.isInteger(progress.count) ||
        progress.count < 1 ||
        progress.count > 60 ||
        progress.index < 0 ||
        progress.index >= progress.count ||
        !progress.frame
      )
        return;
      setState((previous) => {
        const frames =
          previous.frames.length === progress.count
            ? [...previous.frames]
            : new Array(progress.count).fill(null);
        frames[progress.index] = progress.frame;
        return { source, frames, aspect: progress.aspect || 16 / 9 };
      });
    });
    window.api
      .getFilmstrip({ path, duration, count, start, owner, height: FRAME_HEIGHT, requestId })
      .then((result) => {
        if (request.isCurrent() && result?.frames?.length) {
          setState({ source, frames: result.frames, aspect: result.aspect || 16 / 9 });
        }
      })
      .catch(() => {})
      .finally(() => {
        request.finish();
        unsubscribe?.();
      });
    return () => {
      const pending = request.finish();
      unsubscribe?.();
      if (pending) window.api.cancelFilmstrip?.(requestId)?.catch(() => {});
    };
  }, [path, duration, count, start, owner, source, requests]);

  return state.source === source ? state : EMPTY;
}
