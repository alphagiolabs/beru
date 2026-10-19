import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import StabilizationModal from "../src/components/StabilizationModal.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";
import { isStabilizationJob, stabilizationJob } from "../shared/stabilization.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const realExportMediaArtifact = useEditorStore.getState().exportMediaArtifact;

const item = createQueueItem({
  path: "C:\\m\\a b.mp4",
  filename: "a b.mp4",
  width: 1280,
  height: 720,
  duration: 6,
});

describe("stabilization contract", () => {
  it("builds one derived-media job with explicit settings and an optional sample", () => {
    const settings = { intensity: "high", edges: "keep" };
    const job = stabilizationJob(item, settings, { outputPath: "C:/out/a.mp4", sample: true });
    expect(job).toMatchObject({
      id: -2,
      kind: "stabilization",
      input_path: item.path,
      stabilization: settings,
      sample_seconds: 5,
    });
    expect(isStabilizationJob(job)).toBe(true);
    expect(
      stabilizationJob(item, settings, { outputPath: "C:/out/a.mp4" }).sample_seconds,
    ).toBeNull();
  });

  it("rejects unknown settings and out-of-range samples at both boundaries", () => {
    expect(stabilizationJob(item, { intensity: "low" }, { outputPath: "x.mp4" })).toBeNull();
    const job = stabilizationJob(
      item,
      { intensity: "low", edges: "zoom" },
      { outputPath: "x.mp4" },
    );
    expect(
      isStabilizationJob({ ...job, stabilization: { intensity: "extreme", edges: "zoom" } }),
    ).toBe(false);
    expect(isStabilizationJob({ ...job, sample_seconds: 600 })).toBe(false);
    expect(isStabilizationJob({ ...job, id: 0 })).toBe(false);
  });
});

describe("stabilization run routing", () => {
  afterEach(() => {
    delete window.api;
  });

  it.each([true, false])(
    "confirms the variant from the Job on its own channel (sample=%s)",
    async (sample) => {
      const handlers = {},
        runId = `run-${sample}`;
      const startStabilization = vi.fn(async () => {
        handlers.onRunStarted({ runId });
        handlers.onComplete({ runId, index: -2, output: "C:/out/a.mp4" });
        handlers.onFinished({ runId, code: 0 });
        return { success: true, runId };
      });
      window.api = {
        startStabilization,
        startComposition: vi.fn(),
        ...Object.fromEntries(
          ["onRunStarted", "onComplete", "onFinished"].map((key) => [
            key,
            (handler) => {
              handlers[key] = handler;
              return () => {};
            },
          ]),
        ),
      };
      useEditorStore.setState({ isProcessing: false, queue: [item], mediaExport: null });
      const job = stabilizationJob(
        item,
        { intensity: "low", edges: "keep" },
        { outputPath: "C:/out/a.mp4", sample },
      );
      const disconnect = useEditorStore.getState().connectProcessing(window.api);
      const response = await realExportMediaArtifact(job, { signature: "opaque signature" });
      expect(response.ok).toBe(true);
      expect(window.api.startComposition).not.toHaveBeenCalled();
      const [manifest] = startStabilization.mock.calls[0];
      expect(manifest.jobs).toHaveLength(1);
      expect(manifest.jobs[0]).toMatchObject({ kind: "stabilization", id: -2 });
      expect(useEditorStore.getState().mediaExport).toMatchObject({
        confirmedVariant: sample ? "sample" : "full",
        confirmedSourcePath: item.path,
        confirmedSignature: "opaque signature",
      });
      disconnect();
    },
  );
});

describe("StabilizationModal", () => {
  let root = null;
  const exportMediaArtifact = vi.fn(async () => ({ ok: true }));
  const button = (label) =>
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes(label));

  beforeEach(() => {
    exportMediaArtifact.mockClear();
    useEditorStore.setState({
      language: "es",
      queue: [item],
      selectedIdx: 0,
      isProcessing: false,
      outputDir: "C:/out",
      mediaExport: null,
      showStabilizationModal: true,
      exportMediaArtifact,
    });
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    act(() => root.render(React.createElement(StabilizationModal)));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("exports the full video and the sample to separate files from the selected clip", async () => {
    await act(async () => button("Estabilizar video").click());
    await act(async () => button("Probar con 5 s").click());
    const [full, sample] = exportMediaArtifact.mock.calls.map(([job]) => job);
    expect(full).toMatchObject({
      input_path: item.path,
      output_path: "C:/out/a b_stabilized.mp4",
      sample_seconds: null,
      stabilization: { intensity: "medium", edges: "zoom" },
    });
    expect(sample.output_path).toBe("C:/out/a b_stabilized_sample.mp4");
    expect(sample.sample_seconds).toBe(5);
  });

  it("offers a full result and never classifies sample or legacy results from signature serialization", () => {
    const signature = (sample) =>
      JSON.stringify({
        path: item.path,
        settings: { intensity: "medium", edges: "zoom" },
        sample,
      });
    const result = (sample) => ({
      kind: "stabilization",
      status: "done",
      progress: 100,
      confirmedOutputPath: "C:/out/a b_stabilized.mp4",
      confirmedSignature: signature(sample),
      confirmedVariant: sample ? "sample" : "full",
      confirmedAt: 1,
    });
    act(() => useEditorStore.setState({ mediaExport: result(true) }));
    expect(button("Añadir a la cola")).toBeUndefined();
    act(() => useEditorStore.setState({ mediaExport: result(false) }));
    expect(button("Añadir a la cola")).toBeDefined();
    act(() =>
      useEditorStore.setState({
        mediaExport: {
          ...result(true),
          confirmedSignature: JSON.stringify({
            sample: true,
            path: item.path,
            settings: { intensity: "medium", edges: "zoom" },
          }),
        },
      }),
    );
    expect(button("Añadir a la cola")).toBeUndefined();
    act(() =>
      useEditorStore.setState({ mediaExport: { ...result(false), confirmedVariant: null } }),
    );
    expect(button("Añadir a la cola")).toBeUndefined();
  });

  it("disables starting without an output folder and while a run owns the app", () => {
    act(() => useEditorStore.setState({ outputDir: "" }));
    expect(button("Estabilizar video").disabled).toBe(true);
    act(() => useEditorStore.setState({ outputDir: "C:/out", isProcessing: true }));
    expect(button("Probar con 5 s").disabled).toBe(true);
  });
});
