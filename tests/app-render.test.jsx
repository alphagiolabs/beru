import React, { act } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import App from "../src/App.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

window.api = {
  onProgress: () => () => {},
  onJobProgress: () => () => {},
  onComplete: () => () => {},
  onSummary: () => () => {},
  onJobError: () => () => {},
  onFinished: () => () => {},
  onError: () => () => {},
  onLog: () => () => {},
  checkGitHubRelease: async () => ({ ok: true, updateAvailable: false }),
};

describe("App render", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useEditorStore.setState({ queue: [], selectedIdx: -1, language: "es" });
  });

  it("mounts landing without throwing", async () => {
    const root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(<App />);
    });
    expect(document.body.textContent).toMatch(/Importar videos/i);
  });
});