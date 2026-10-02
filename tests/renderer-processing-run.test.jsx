import { act } from "react";
import { createRoot } from "react-dom/client";
import { EventEmitter } from "node:events";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IPC_EVENTS, RUN_SCOPED_CHANNELS } from "../shared/ipc-channels.js";
import { createQueueItem } from "../src/utils/types.js";

const events = new EventEmitter();
let requests;
const api = {
  startProcessing: vi.fn((manifest) => {
    let resolve;
    let reject;
    const pending = new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    });
    requests.push({ manifest, resolve, reject });
    return pending;
  }),
  cancelProcessing: vi.fn(async () => ({ success: true })),
};
for (const [name, channel] of Object.entries(IPC_EVENTS)) {
  if (!RUN_SCOPED_CHANNELS.has(channel)) continue;
  api[name] = (listener) => {
    events.on(name, listener);
    return () => events.off(name, listener);
  };
}
window.api = api;

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
const { default: useProcessing } = await import("../src/hooks/useProcessing.js");
const { default: Header } = await import("../src/components/Header.jsx");

globalThis.React = await import("react");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ header = false }) {
  useProcessing(api);
  return header ? <Header /> : null;
}

const get = useEditorStore.getState;
let runSequence = 0;
const scoped = (payload) =>
  payload.runId ? { ...payload, runId: `${runSequence}-${payload.runId}` } : payload;
const emit = (name, payload) => act(() => events.emit(name, scoped(payload)));
let root;
let showToast;

function mount(header = false) {
  act(() => root.render(<Harness header={header} />));
}

function start(runId, videoIdx = null) {
  let pending;
  act(() => {
    pending = videoIdx == null ? get().processAll() : get().processSingle(videoIdx);
  });
  emit("onRunStarted", { runId });
  return pending;
}

async function reply(index, result, pending) {
  let outcome;
  await act(async () => {
    requests[index].resolve(scoped(result));
    outcome = await pending;
  });
  return outcome;
}

beforeEach(() => {
  runSequence++;
  requests = [];
  showToast = vi.fn();
  api.startProcessing.mockClear();
  api.cancelProcessing.mockReset().mockResolvedValue({ success: true });
  events.removeAllListeners();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  useEditorStore.setState({
    queue: ["a", "b", "c"].map((name) =>
      createQueueItem({
        path: `C:\\videos\\${name}.mp4`,
        filename: `${name}.mp4`,
        width: 1920,
        height: 1080,
        duration: 10,
        pixFmt: "yuv420p",
      }),
    ),
    selectedIdx: 0,
    outputDir: "C:\\output",
    sidebarMode: "logo",
    templateRegions: [],
    isProcessing: false,
    activeProcessRunId: null,
    progressDone: 0,
    progressTotal: 0,
    jobProgress: {},
    batchSummary: null,
    exportSignatures: {},
    watermark: { enabled: false },
    language: "es",
    showToast,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("renderer Processing Run through the store and IPC adapter", () => {
  it("keeps completed artifacts and job errors after partial batch cancellation", async () => {
    mount();
    const pending = start("run-a");
    emit("onComplete", { runId: "run-a", index: 0, output: "C:\\output\\a.mp4" });
    emit("onJobError", { runId: "run-a", index: 1, error: "Invalid video" });
    emit("onJobProgress", { runId: "run-a", index: 2, percent: 40 });
    emit("onFinished", { runId: "run-a", code: null, cancelled: true });
    await reply(0, { success: false, cancelled: true, runId: "run-a" }, pending);

    expect(get().queue[0]).toMatchObject({
      status: "done",
      progress: 100,
      exportedOutputPath: "C:\\output\\a.mp4",
      exportSignature: expect.any(String),
    });
    expect(get().queue[1]).toMatchObject({ status: "error", error: "Invalid video" });
    expect(get().queue[2]).toMatchObject({ status: "idle", progress: 0, error: null });
    expect(get().isProcessing).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("preserves confirmed single-job completion despite a later run failure", async () => {
    mount();
    const pending = start("run-a", 1);
    emit("onComplete", { runId: "run-a", index: 1, output: "C:\\output\\b.mp4" });
    emit("onFinished", { runId: "run-a", code: 1, error: "Worker disconnected" });
    const result = await reply(
      0,
      { success: false, code: 1, error: "Worker disconnected", runId: "run-a" },
      pending,
    );

    expect(get().queue[1]).toMatchObject({
      status: "done",
      exportedOutputPath: "C:\\output\\b.mp4",
    });
    expect(result).toMatchObject({ ok: true, outputPath: "C:\\output\\b.mp4" });
    expect(showToast).toHaveBeenCalledOnce();
  });

  it("a busy single-job reply preserves the ongoing main run and can observe its finish", async () => {
    mount();
    let pending;
    act(() => {
      pending = get().processSingle(1);
    });
    const result = await reply(
      0,
      { success: false, code: "already_processing", error: "Busy" },
      pending,
    );

    expect(result.code).toBe("already_processing");
    expect(get().isProcessing).toBe(true);
    expect(get().queue[1]).toMatchObject({ status: "idle", error: null });
    emit("onComplete", { runId: "main-run", index: 0, output: "C:\\output\\a.mp4" });
    emit("onFinished", { runId: "main-run", code: 0 });
    expect(get().queue[0].status).toBe("done");
    expect(get().isProcessing).toBe(false);
  });

  it("an old IPC response cannot restore the queue or stop a newer run", async () => {
    mount();
    const old = start("run-a");
    emit("onFinished", { runId: "run-a", code: null, cancelled: true });
    const current = start("run-b", 2);
    emit("onJobProgress", { runId: "run-b", index: 2, percent: 75 });
    await reply(0, { success: false, cancelled: true, runId: "run-a" }, old);

    expect(get().isProcessing).toBe(true);
    expect(get().activeProcessRunId).toBe(`${runSequence}-run-b`);
    expect(get().queue[2].status).toBe("processing");
    emit("onFinished", { runId: "run-b", code: 0 });
    await reply(1, { success: true, runId: "run-b" }, current);
  });

  it("a busy reply cannot reopen an observed main run that already finished", async () => {
    mount();
    const pending = start("main-run");
    emit("onComplete", { runId: "main-run", index: 0, output: "C:\\output\\a.mp4" });
    emit("onFinished", { runId: "main-run", code: 0 });
    const result = await reply(0, { success: false, code: "already_processing" }, pending);
    expect(result).toMatchObject({ ok: false, code: "already_processing" });
    expect(get().isProcessing).toBe(false);
    expect(get().queue[0].status).toBe("done");
    expect(showToast).not.toHaveBeenCalled();
  });

  it("a fatal event and its IPC reply show one error and preserve finished jobs", async () => {
    mount(true);
    act(() => document.querySelector('[data-testid="header-process-all"]').click());
    emit("onRunStarted", { runId: "run-a" });
    emit("onComplete", { runId: "run-a", index: 0, output: "C:\\output\\a.mp4" });
    emit("onJobProgress", { runId: "run-a", index: 1, percent: 50 });
    emit("onError", { runId: "run-a", error: "Worker disconnected" });
    emit("onFinished", { runId: "run-a", code: 1, error: "Worker disconnected" });
    await act(async () => {
      requests[0].resolve(scoped({ success: false, error: "Worker disconnected", runId: "run-a" }));
    });

    expect(showToast).toHaveBeenCalledOnce();
    expect(get().queue[0].status).toBe("done");
    expect(get().queue[1]).toMatchObject({ status: "idle", progress: 0, error: null });
    expect(get().isProcessing).toBe(false);
  });

  it("counts a retried job once and rejects duplicate or contradictory terminal messages", async () => {
    mount();
    const pending = start("run-a");
    emit("onJobError", { runId: "run-a", index: 0, error: "GPU failed" });
    emit("onComplete", { runId: "run-a", index: 0, output: "C:\\output\\a.mp4" });
    emit("onComplete", { runId: "run-a", index: 0, output: "C:\\output\\a.mp4" });
    emit("onJobCancelled", { runId: "run-a", index: 0 });

    expect(get().queue[0].status).toBe("done");
    expect(get().progressDone).toBe(1);
    emit("onFinished", { runId: "run-a", code: 0 });
    await reply(0, { success: true, runId: "run-a" }, pending);
  });

  it.each(["reply", "throw"])(
    "restores pre-start results while retaining live edits on a %s failure",
    async (failure) => {
      mount();
      act(() =>
        useEditorStore.setState({
          queue: get().queue.map((item, index) =>
            index === 0
              ? { ...item, status: "done", progress: 100, exportedOutputPath: "C:\\existing.mp4" }
              : item,
          ),
        }),
      );
      let pending;
      act(() => {
        pending = get().processAll();
      });
      act(() =>
        useEditorStore.setState({
          queue: get().queue.map((item, index) =>
            index === 1 ? { ...item, customOutputName: "edited.mp4" } : item,
          ),
        }),
      );
      let result;
      await act(async () => {
        if (failure === "throw") requests[0].reject(new Error("spawn failed"));
        else requests[0].resolve({ success: false, error: "spawn failed" });
        result = await pending;
      });
      expect(result).toMatchObject({ ok: false, error: "spawn failed", notified: true });
      expect(get().queue[0]).toMatchObject({
        status: "done",
        exportedOutputPath: "C:\\existing.mp4",
      });
      expect(get().queue[1].customOutputName).toBe("edited.mp4");
      expect(get().isProcessing).toBe(false);
      expect(showToast).toHaveBeenCalledOnce();
    },
  );

  it("uses the final reply when no events arrive and releases a single run", async () => {
    mount();
    let pending;
    act(() => {
      pending = get().processSingle(1);
    });
    expect(get().isProcessing).toBe(true);
    const result = await reply(0, { success: true }, pending);
    expect(result).toMatchObject({ ok: true, outputPath: "C:\\output\\b_beru.mp4" });
    expect(get().isProcessing).toBe(false);
    expect(get().queue[1].status).toBe("idle");
  });

  it("cannot reopen a run identified only by its final reply", async () => {
    mount();
    let pending;
    act(() => {
      pending = get().processAll();
    });
    await reply(0, { success: true, runId: "run-a" }, pending);
    emit("onRunStarted", { runId: "run-a" });
    emit("onJobProgress", { runId: "run-a", index: 0, percent: 70 });
    expect(get().isProcessing).toBe(false);
    expect(get().activeProcessRunId).toBeNull();
    expect(get().queue[0].status).toBe("idle");
  });

  it("returns the job error even when the processor finishes successfully", async () => {
    mount();
    const pending = start("run-a", 1);
    emit("onJobError", { runId: "run-a", index: 1, error: "Encoding failed" });
    emit("onFinished", { runId: "run-a", code: 0 });
    const result = await reply(0, { success: true, runId: "run-a" }, pending);
    expect(result).toMatchObject({ ok: false, error: "Encoding failed" });
    expect(get().queue[1]).toMatchObject({ status: "error", error: "Encoding failed" });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("cancels without a finished event and retains completed exports", async () => {
    mount();
    const pending = start("run-a");
    emit("onComplete", { runId: "run-a", index: 0, output: "C:\\output\\a.mp4" });
    emit("onJobProgress", { runId: "run-a", index: 1, percent: 30 });
    await act(async () => {
      await get().cancelProcessing();
    });
    expect(api.cancelProcessing).toHaveBeenCalledOnce();
    expect(get().isProcessing).toBe(false);
    expect(get().queue[0].status).toBe("done");
    expect(get().queue[1].status).toBe("idle");
    expect(showToast).not.toHaveBeenCalled();
    expect(await reply(0, { success: false, cancelled: true }, pending)).toMatchObject({
      cancelled: true,
    });
  });

  it("a rejected cancellation keeps the run active and reports its error", async () => {
    mount();
    const pending = start("run-a", 1);
    api.cancelProcessing.mockRejectedValueOnce(new Error("cancel failed"));
    await act(async () => {
      await get().cancelProcessing();
    });
    expect(get().isProcessing).toBe(true);
    expect(get().queue[1].status).toBe("processing");
    expect(showToast).toHaveBeenCalledOnce();
    emit("onFinished", { runId: "run-a", code: 0 });
    await reply(0, { success: true, runId: "run-a" }, pending);
  });

  it("a late cancellation acknowledgement cannot stop a newer run", async () => {
    mount();
    let acknowledge;
    api.cancelProcessing.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const old = start("run-a");
    let cancelling;
    act(() => {
      cancelling = get().cancelProcessing();
    });
    emit("onFinished", { runId: "run-a", cancelled: true });
    const pending = start("run-b", 2);
    await act(async () => {
      acknowledge({ success: true });
      await cancelling;
    });
    expect(get().activeProcessRunId).toBe(`${runSequence}-run-b`);
    expect(get().isProcessing).toBe(true);
    await reply(0, { success: false, cancelled: true }, old);
    emit("onFinished", { runId: "run-b", code: 0 });
    await reply(1, { success: true }, pending);
  });

  it("ignores old events, unrelated job indices and buffered progress after completion", async () => {
    vi.useFakeTimers();
    mount();
    const old = start("run-a");
    emit("onFinished", { runId: "run-a", cancelled: true });
    const pending = start("run-b", 2);
    emit("onJobProgress", { runId: "run-b", index: 2, percent: 40 });
    emit("onComplete", { runId: "run-b", index: 2, output: "C:\\output\\c.mp4" });
    emit("onJobError", { runId: "run-a", index: 2, error: "Old error" });
    emit("onComplete", { runId: "run-b", index: 0 });
    emit("onFinished", { runId: "run-a", code: 1 });
    act(() => vi.advanceTimersByTime(100));
    expect(get().queue[2]).toMatchObject({ status: "done", progress: 100 });
    expect(get().queue[0].status).toBe("idle");
    expect(get().isProcessing).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
    await reply(0, { success: false, cancelled: true }, old);
    emit("onFinished", { runId: "run-b", code: 0 });
    await reply(1, { success: true }, pending);
  });

  it("unsubscribes and discards pending progress when the IPC adapter unmounts", async () => {
    vi.useFakeTimers();
    mount();
    const pending = start("run-a");
    emit("onJobProgress", { runId: "run-a", index: 0, percent: 40 });
    act(() => root.render(null));
    emit("onComplete", { runId: "run-a", index: 0 });
    act(() => vi.advanceTimersByTime(100));
    expect(get().queue[0].status).toBe("idle");
    expect(events.eventNames()).toHaveLength(0);
    await reply(0, { success: true, runId: "run-a" }, pending);
  });

  it.each([null, 1])(
    "reports an unavailable transport without starting a run (%s)",
    async (videoIdx) => {
      const savedApi = window.api;
      window.api = {};
      try {
        const result =
          videoIdx == null ? await get().processAll() : await get().processSingle(videoIdx);
        expect(result).toMatchObject({ ok: false, code: "api_unavailable" });
        expect(get().isProcessing).toBe(false);
        expect(requests).toHaveLength(0);
      } finally {
        window.api = savedApi;
      }
    },
  );
});
