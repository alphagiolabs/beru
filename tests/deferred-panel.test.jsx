import React, { act, lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeferredPanel from "../src/components/DeferredPanel.jsx";
import useEditorStore from "../src/stores/useEditorStore.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function DraftPanel() {
  const open = useEditorStore((s) => s.showShortcuts);
  const [draft, setDraft] = useState(0);
  if (!open) return null;
  return <button onClick={() => setDraft((value) => value + 1)}>Draft {draft}</button>;
}

describe("deferred panel lifecycle", () => {
  let container;
  let root;
  beforeEach(() => {
    useEditorStore.setState({ showShortcuts: false });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useEditorStore.setState({ showShortcuts: false });
  });

  const render = (Panel) => (
    <>
      <main>Workspace</main>
      <Suspense fallback={<p>Loading panel</p>}>
        <DeferredPanel when={(s) => s.showShortcuts}>
          <Panel />
        </DeferredPanel>
      </Suspense>
    </>
  );

  it("loads on first opening and preserves the draft across closing and reopening", async () => {
    const load = vi.fn(async () => ({ default: DraftPanel }));
    const Panel = lazy(load);
    await act(async () => root.render(render(Panel)));
    expect(load).not.toHaveBeenCalled();
    expect(container.querySelector("button")).toBeNull();

    await act(async () => useEditorStore.getState().setShowShortcuts(true));
    expect(load).toHaveBeenCalledOnce();
    act(() => container.querySelector("button").click());
    expect(container.querySelector("button").textContent).toBe("Draft 1");

    act(() => useEditorStore.getState().setShowShortcuts(false));
    expect(container.querySelector("button")).toBeNull();
    await act(async () => useEditorStore.getState().setShowShortcuts(true));
    expect(container.querySelector("button").textContent).toBe("Draft 1");
    expect(load).toHaveBeenCalledOnce();
  });

  it("does not show a panel closed before its module finishes loading", async () => {
    let finish;
    const load = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const Panel = lazy(load);
    await act(async () => root.render(render(Panel)));
    act(() => useEditorStore.getState().setShowShortcuts(true));
    expect(container.querySelector("main").textContent).toBe("Workspace");
    expect(load).toHaveBeenCalledOnce();
    act(() => useEditorStore.getState().setShowShortcuts(false));
    await act(async () => finish({ default: DraftPanel }));
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe("Workspace");
    await act(async () => useEditorStore.getState().setShowShortcuts(true));
    expect(container.querySelector("button").textContent).toBe("Draft 0");
    expect(load).toHaveBeenCalledOnce();
  });
});
