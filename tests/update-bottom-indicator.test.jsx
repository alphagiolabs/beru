import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import useEditorStore from "../src/stores/useEditorStore";
import UpdateBottomIndicator from "../src/components/UpdateBottomIndicator";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;

describe("UpdateBottomIndicator", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    useEditorStore.setState({
      update: {
        status: "idle",
        version: null,
        percent: 0,
        error: null,
        transferred: 0,
        total: 0,
        releaseNotes: "",
        releaseUrl: null,
      },
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

  it("renders a blinking bottom bar while downloading", async () => {
    useEditorStore.setState((s) => ({
      update: { ...s.update, status: "downloading", version: "1.6.16", percent: 42 },
    }));

    await act(async () => {
      root.render(<UpdateBottomIndicator />);
    });

    const bar = document.querySelector(".update-bottom-indicator");
    expect(bar).toBeTruthy();
    expect(bar.getAttribute("aria-label")).toMatch(/Actualizando Beru/i);
  });

  it("stays hidden when no update is in progress", async () => {
    await act(async () => {
      root.render(<UpdateBottomIndicator />);
    });

    expect(document.querySelector(".update-bottom-indicator")).toBeNull();
  });
});
