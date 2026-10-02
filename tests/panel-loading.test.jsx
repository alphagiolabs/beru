import React, { act, lazy, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DeferredPanel from "../src/components/DeferredPanel.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  useEditorStore.setState({ showShortcuts: false, showWatermarkModal: false, language: "es" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useEditorStore.setState({ showShortcuts: false, showWatermarkModal: false });
});

it("shows a cancellable localized status without hiding the workspace or another panel", async () => {
  let finish;
  const mount = vi.fn();
  function ResolvedPanel() {
    useEffect(() => {
      mount();
    }, []);
    return null;
  }
  const Pending = lazy(() => new Promise((resolve) => (finish = resolve)));
  const close = () => useEditorStore.getState().setShowShortcuts(false);
  await act(async () =>
    root.render(
      <>
        <main>Workspace</main>
        <Suspense fallback={null}>
          <DeferredPanel when={(s) => s.showWatermarkModal}>
            <p>Other panel</p>
          </DeferredPanel>
          <DeferredPanel when={(s) => s.showShortcuts} label="Atajos" onClose={close}>
            <Pending />
          </DeferredPanel>
        </Suspense>
      </>,
    ),
  );
  expect(container.querySelector('[role="status"]')).toBeNull();
  act(() => useEditorStore.setState({ showShortcuts: true, showWatermarkModal: true }));
  expect(container.querySelector('[role="status"]').textContent).toBe("Cargando Atajos…");
  expect(container.querySelector("main").style.display).not.toBe("none");
  expect(container.textContent).toContain("Other panel");

  act(() => container.querySelector('button[aria-label="Cerrar"]').click());
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(useEditorStore.getState().showShortcuts).toBe(false);
  await act(async () => finish({ default: ResolvedPanel }));
  expect(mount).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toBe("WorkspaceOther panel");
});
