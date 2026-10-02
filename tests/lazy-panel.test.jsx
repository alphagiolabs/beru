import React, { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { lazyPanel } from "../src/utils/lazy-panel.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("preloads once without mounting and opens a ready panel without a loading frame", async () => {
  const mount = vi.fn();
  const load = vi.fn(async () => ({
    default: () => {
      mount();
      return <p>Ready panel</p>;
    },
  }));
  const Panel = lazyPanel(load);
  expect(load).not.toHaveBeenCalled();
  await Promise.all([Panel.preload(), Panel.preload()]);
  expect(load).toHaveBeenCalledOnce();
  expect(mount).not.toHaveBeenCalled();

  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <Suspense fallback={<p>Loading</p>}>
          <Panel />
        </Suspense>,
      ),
    );
    expect(container.textContent).toBe("Ready panel");
    act(() =>
      root.render(
        <Suspense fallback={<p>Loading</p>}>
          <Panel />
        </Suspense>,
      ),
    );
    expect(container.textContent).toBe("Ready panel");
    expect(load).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});

it("allows opening after a speculative import failed", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("Speculative load failed"))
    .mockResolvedValueOnce({ default: () => <p>Recovered panel</p> });
  const Panel = lazyPanel(load);
  await Panel.preload();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <Suspense fallback={<p>Loading</p>}>
          <Panel />
        </Suspense>,
      ),
    );
    expect(container.textContent).toBe("Recovered panel");
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
