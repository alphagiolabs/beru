export function observeRenderer() {
  const state = (window.__beruPerf = { frames: [], hidden: false, last: 0 });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") state.hidden = true;
  });
  requestAnimationFrame(function frame(time) {
    if (state.last) state.frames.push(time - state.last);
    state.last = time;
    requestAnimationFrame(frame);
  });
  state.wait = async (predicate, label) => {
    const started = performance.now();
    while (!predicate()) {
      if (performance.now() - started > 60000) throw new Error(`Timeout: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  state.paint = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export async function importVideos(paths) {
  const store = window.__beruPerfStore;
  const api = window.api;
  store.getState().clearQueue();
  await api.resolveDroppedPaths(paths);
  await store.getState().addVideos(paths, api);
  await window.__beruPerf.wait(
    () =>
      store.getState().queue.length === paths.length &&
      store.getState().queue.every((item) => item.width > 0 && item.duration > 0) &&
      paths.every((path) => store.getState().thumbnailsByPath[path]),
    "metadata and thumbnails",
  );
  await window.__beruPerf.paint();
  return { count: store.getState().queue.length };
}

export async function previewFrames({ path, timestamps, processed = false }) {
  const elapsedMs = [];
  for (const timestamp of timestamps) {
    const started = performance.now();
    const result = processed
      ? await window.api.renderPreviewFrame(
          window.__beruPerfStore.getState().buildPreviewFrameJob(0, timestamp),
        )
      : await window.api.renderSourceFrame({ input_path: path, timestamp });
    if (!result?.ok || !result.data_url) throw new Error(result?.error || "Preview failed");
    const image = new Image();
    image.src = result.data_url;
    await image.decode();
    if (!image.naturalWidth) throw new Error("Empty preview image");
    elapsedMs.push(performance.now() - started);
  }
  return { elapsedMs };
}

export async function exportWithPreview({ paths, outputDir }) {
  const store = window.__beruPerfStore;
  const api = window.api;
  await api.restoreSessionPaths({ outputDir, videoPaths: paths });
  await api.saveSettings({
    batchWorkers: 2,
    batchWorkersMode: "balanced",
    batchRetryFailed: false,
  });
  store.setState({ outputDir });
  await store.getState().setEncodeProfile("balanced");
  for (let index = 0; index < 2; index++) {
    store.getState().selectVideo(index);
    store.getState().setCurrentRegion({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 });
    store.getState().addOperation("blur");
    store.getState().setVideoTrim(index, 0, 4, 12);
  }
  store.getState().selectVideo(0);
  await window.__beruPerf.wait(() => document.querySelector("video")?.readyState >= 2, "video");
  const video = document.querySelector("video");
  video.currentTime = 0;
  await video.play();
  let finished;
  let maxActiveJobs = 0;
  const failures = [];
  const unsubscribe = [
    api.onFinished((result) => (finished = result)),
    api.onError((result) => failures.push(result)),
    api.onJobError((result) => failures.push(result)),
    store.subscribe((state) => {
      maxActiveJobs = Math.max(
        maxActiveJobs,
        state.queue.filter((item) => item.status === "processing").length,
      );
    }),
  ];
  try {
    const start = await store.getState().processAll();
    if (!start?.ok && start?.success !== true) throw new Error(JSON.stringify(start));
    const overlapped = store.getState().isProcessing && !finished;
    const previewStarted = performance.now();
    const preview = await api.renderSourceFrame({ input_path: paths[0], timestamp: 2.75 });
    if (!preview?.ok) throw new Error(preview?.error || "Concurrent preview failed");
    const previewMs = performance.now() - previewStarted;
    await window.__beruPerf.wait(() => finished !== undefined, "export finished event");
    await window.__beruPerf.wait(() => !store.getState().isProcessing, "export state");
    const statuses = store.getState().queue.map((item) => item.status);
    if (
      !overlapped ||
      failures.length ||
      finished.code !== 0 ||
      statuses.some((s) => s !== "done")
    ) {
      throw new Error(JSON.stringify({ overlapped, failures, finished, statuses }));
    }
    const quality = video.getVideoPlaybackQuality();
    return {
      overlapped,
      requestedWorkers: 2,
      maxActiveJobs,
      previewMs,
      statuses,
      summary: store.getState().batchSummary,
      videoFrames: { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames },
    };
  } finally {
    video.pause();
    unsubscribe.forEach((off) => off());
  }
}
