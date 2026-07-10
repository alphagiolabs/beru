import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import useProcessing from "../src/hooks/useProcessing.js";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ api }) {
  useProcessing(api);
  return null;
}

describe("useProcessing process:finished non-zero exit", () => {
  let root = null;
  let onFinishedHandler = null;
  let showToast;

  beforeEach(() => {
    onFinishedHandler = null;
    showToast = vi.fn();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    useEditorStore.setState({
      isProcessing: true,
      activeExecutionId: "run-1",
      executionHistory: [
        {
          id: "run-1",
          kind: "batch",
          startedAt: Date.now(),
          endedAt: null,
          jobCount: 1,
          lines: [],
          summary: null,
        },
      ],
      queue: [
        {
          path: "C:\\videos\\a.mp4",
          filename: "a.mp4",
          width: 1920,
          height: 1080,
          status: "processing",
          progress: 40,
          error: null,
          operations: [],
        },
      ],
      jobProgress: { 0: 40 },
      language: "es",
      showToast,
    });
  });

  afterEach(async () => {
    if (root) {
      await act(() => {
        root.unmount();
      });
      root = null;
    }
  });

  it("toasts and aborts when finished with code !== 0", () => {
    const api = {
      onFinished: (cb) => {
        onFinishedHandler = cb;
        return () => {};
      },
    };

    act(() => {
      root.render(<Harness api={api} />);
    });

    act(() => {
      onFinishedHandler({ code: 1, error: "Process exited with code 1" });
    });

    const state = useEditorStore.getState();
    expect(state.isProcessing).toBe(false);
    expect(state.queue[0].status).toBe("idle");
    expect(showToast).toHaveBeenCalledOnce();
    expect(showToast.mock.calls[0][0].kind).toBe("err");
  });

  it("does not toast on successful finished", () => {
    const api = {
      onFinished: (cb) => {
        onFinishedHandler = cb;
        return () => {};
      },
    };

    act(() => {
      root.render(<Harness api={api} />);
    });

    act(() => {
      onFinishedHandler({ code: 0 });
    });

    expect(useEditorStore.getState().isProcessing).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });
});
