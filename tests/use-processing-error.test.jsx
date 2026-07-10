import React, { act, useEffect } from "react";
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

describe("useProcessing fatal process:error", () => {
  let root = null;
  let onErrorHandler = null;

  beforeEach(() => {
    onErrorHandler = null;
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
      showToast: vi.fn(),
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

  it("aborts in-flight rows and finalizes the active execution", () => {
    const api = {
      onError: (cb) => {
        onErrorHandler = cb;
        return () => {};
      },
    };

    act(() => {
      root.render(<Harness api={api} />);
    });

    act(() => {
      onErrorHandler("spawn failed");
    });

    const state = useEditorStore.getState();
    expect(state.isProcessing).toBe(false);
    expect(state.activeExecutionId).toBeNull();
    expect(state.queue[0].status).toBe("idle");
    expect(state.jobProgress).toEqual({});
  });
});
