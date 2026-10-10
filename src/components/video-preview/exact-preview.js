import useEditorStore from "../../stores/useEditorStore";
import { buildLogoPreviewJob } from "../../utils/delogo-ops";
import { isRegionUsable } from "../../utils/video-utils";
import {
  createJobSignatureCache,
  jobInputEntriesEqual,
  previewJobInputSnapshot,
} from "../../utils/job-signature";

function logoDraft(state) {
  if (state.sidebarMode !== "logo" || !isRegionUsable(state.currentRegion)) return null;
  if (!["blur", "delogo", "crop"].includes(state.activeTool)) return null;
  return {
    mode: state.activeTool,
    region: state.currentRegion,
    delogoMethod: state.delogoMethod,
    blurStrength: state.blurStrength,
    edgeFeather: state.edgeFeather,
    temporalRadius: state.temporalRadius,
    mosaicSize: state.mosaicSize,
    mirrorSide: state.mirrorSide,
    delogoFillColor: state.delogoFillColor,
    delogoFillOpacity: state.delogoFillOpacity,
    delogoImagePath: state.delogoImagePath,
    startTime: state.tempStart,
    endTime: state.tempEnd,
  };
}

export function createExactPreview({ videoRef, onChange, t }) {
  let state = {
    url: null,
    loading: false,
    error: null,
    artifact: false,
    stale: false,
    compareMode: "live",
  };
  let generation = 0;
  let request = null;
  let renderedSignature = null;
  let lastSignature = null;
  let dismissedSignature = null;
  let context = [];
  let editingInputs = [];
  let timer = null;
  let gestureActive = false;
  let pendingGesture = false;
  let enabled = false;
  let disposed = false;
  const jobSignature = createJobSignatureCache();

  function publish(patch) {
    if (disposed || Object.entries(patch).every(([key, value]) => Object.is(state[key], value)))
      return;
    state = { ...state, ...patch };
    onChange(state);
  }

  function clearTimer() {
    clearTimeout(timer);
    timer = null;
    pendingGesture = false;
  }

  function invalidate() {
    generation += 1;
    request = null;
    publish({ loading: false });
  }

  function reset() {
    clearTimer();
    invalidate();
    gestureActive = false;
    enabled = false;
    renderedSignature = null;
    lastSignature = null;
    dismissedSignature = null;
    publish({
      url: null,
      error: null,
      artifact: false,
      stale: false,
      compareMode: useEditorStore.getState().sidebarMode === "logo" ? "live" : "ffmpeg",
    });
  }

  function signature() {
    const editor = useEditorStore.getState();
    const draft = logoDraft(editor);
    const timestamp = videoRef.current?.currentTime ?? 0;
    return jobSignature(previewJobInputSnapshot(editor, editor.selectedIdx, draft), timestamp, () =>
      buildLogoPreviewJob(editor.buildPreviewFrameJob(editor.selectedIdx, timestamp), draft),
    );
  }

  function schedule(delay = 450) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (gestureActive) {
        pendingGesture = true;
        return;
      }
      if (videoRef.current && !videoRef.current.paused) return;
      void render(true);
    }, delay);
  }

  function synchronize(event) {
    if (disposed) return;
    const editor = useEditorStore.getState();
    const item = editor.queue[editor.selectedIdx];
    const nextContext = [editor.selectedIdx, item?.path, editor.sidebarMode];
    if (!jobInputEntriesEqual(context, nextContext)) {
      context = nextContext;
      reset();
    }
    const nextEditing = [
      editor.activeTool,
      editor.currentRegion,
      item?.operations,
      editor.blurStrength,
      editor.delogoMethod,
    ];
    if (!jobInputEntriesEqual(editingInputs, nextEditing)) {
      editingInputs = nextEditing;
      if (editor.sidebarMode === "logo") publish({ compareMode: "live" });
    }
    if (!item?.path) return;
    if (!enabled && editor.sidebarMode !== "logo") return;
    if (
      editor.sidebarMode === "logo" &&
      (event?.type === "play" || (videoRef.current && !videoRef.current.paused))
    ) {
      reset();
      return;
    }
    const next = signature();
    const changed = next !== lastSignature;
    lastSignature = next;
    if (changed) dismissedSignature = null;
    const obsoleteRequest = request?.signature && request.signature !== next;
    if (obsoleteRequest) invalidate();
    if (renderedSignature && next === renderedSignature) {
      clearTimer();
      publish({ stale: false });
      return;
    }
    if (renderedSignature) publish({ stale: true });
    if (!changed && !event) return;
    if (
      !next ||
      next === dismissedSignature ||
      request ||
      (videoRef.current && !videoRef.current.paused)
    )
      return;
    const autoLogo =
      editor.sidebarMode === "logo" &&
      (logoDraft(editor) ||
        item.operations?.some((op) => ["blur", "delogo", "crop"].includes(op.mode)));
    if (enabled || autoLogo) schedule();
  }

  function fail(message) {
    publish({ error: message });
    useEditorStore.getState().showToast?.({ kind: "err", text: message });
  }

  async function render(keepFrame = false) {
    if (disposed) return;
    clearTimer();
    const api = window.api;
    const editor = useEditorStore.getState();
    const idx = editor.selectedIdx;
    const item = editor.queue[idx];
    if (!api?.renderPreviewFrame) {
      fail(t("preview.ffmpegUnavailable"));
      return;
    }
    if (!item?.path) {
      fail(t("preview.selectVideoFirst"));
      return;
    }
    enabled = true;
    const token = ++generation;
    request = { signature: null };
    dismissedSignature = null;
    publish({ loading: true, error: null });
    if (!keepFrame) {
      renderedSignature = null;
      publish({ url: null, stale: false, artifact: false });
    }
    const current = () => !disposed && token === generation;
    try {
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
      clearTimer();
      if (!(item.width > 0 && item.height > 0) && api.getVideoInfo) {
        try {
          await editor.refreshMissingVideoInfo?.(api);
        } catch {}
        if (!current()) return;
      }
      const live = useEditorStore.getState();
      const draft = logoDraft(live);
      const baseJob = live.buildPreviewFrameJob(idx, video?.currentTime ?? 0);
      const job = buildLogoPreviewJob(baseJob, draft);
      if (!job) {
        fail(t("logo.jobError"));
        return;
      }
      const sig = JSON.stringify(job);
      request.signature = sig;
      lastSignature = sig;
      const valid = () => current() && signature() === sig;
      const { timestamp: _timestamp, ...exportShape } = baseJob;
      const liveItem = live.queue[idx];
      const artifactPath =
        !draft &&
        liveItem?.exportSignature === JSON.stringify(exportShape) &&
        liveItem.exportedOutputStat
          ? liveItem.exportedOutputPath
          : null;
      let result;
      let artifact = false;
      if (artifactPath && api.renderSourceFrame) {
        const trimStart = Math.max(0, Number(job.trim_start) || 0);
        const end = Number(job.trim_end ?? job.video_duration);
        const lastFrame =
          end > trimStart
            ? Math.max(0, end - trimStart - 1 / (Number(job.frame_rate) || 30))
            : Infinity;
        result = await api.renderSourceFrame({
          input_path: artifactPath,
          timestamp: Math.min(lastFrame, Math.max(0, job.timestamp - trimStart)),
          expected_stat: liveItem.exportedOutputStat,
        });
        if (!valid()) return;
        artifact = !!result?.ok;
      }
      if (!result?.ok) {
        result = await api.renderPreviewFrame(job);
        if (!valid()) return;
        artifact = false;
      }
      if (result?.ok && result.data_url) {
        renderedSignature = sig;
        publish({
          url: result.data_url,
          artifact,
          stale: false,
          compareMode: live.sidebarMode === "logo" ? state.compareMode : "ffmpeg",
        });
      } else if (!result?.cancelled) fail(result?.error || t("logo.renderError"));
    } catch (error) {
      if (current()) fail(error.message || t("logo.renderError"));
    } finally {
      if (current()) {
        request = null;
        publish({ loading: false });
      }
    }
  }

  function dismiss() {
    reset();
    dismissedSignature = signature();
    lastSignature = dismissedSignature;
  }
  function selectComparison(mode) {
    publish({ compareMode: mode });
  }
  function beginGesture() {
    const editor = useEditorStore.getState();
    if (editor.sidebarMode !== "logo" || editor.activeTool === "pan") return;
    gestureActive = true;
    selectComparison("live");
  }
  function finishGesture() {
    if (!gestureActive) return;
    gestureActive = false;
    if (pendingGesture) {
      pendingGesture = false;
      schedule(150);
    }
  }

  const unsubscribe = useEditorStore.subscribe(() => synchronize());
  const video = videoRef.current;
  const mediaEvents = ["timeupdate", "seeked", "pause", "ended", "play"];
  for (const event of mediaEvents) video?.addEventListener(event, synchronize);
  const onRender = () => void render();
  window.addEventListener("beru:preview:renderFrame", onRender);
  window.addEventListener("mouseup", finishGesture);
  window.addEventListener("blur", finishGesture);
  onChange(state);
  synchronize();
  return {
    toggle() {
      if (state.url && !state.loading) dismiss();
      else void render();
    },
    dismiss,
    selectComparison,
    beginGesture,
    dispose() {
      disposed = true;
      clearTimer();
      generation += 1;
      unsubscribe();
      for (const event of mediaEvents) video?.removeEventListener(event, synchronize);
      window.removeEventListener("beru:preview:renderFrame", onRender);
      window.removeEventListener("mouseup", finishGesture);
      window.removeEventListener("blur", finishGesture);
    },
  };
}
