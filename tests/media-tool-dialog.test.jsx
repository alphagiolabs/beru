import * as React from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import MediaToolDialog from "../src/components/MediaToolDialog.jsx";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

it.each(["escape", "close button"])("returns focus to the opener after %s", async (method) => {
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open media tool</button>
        <MediaToolDialog open={open} onOpenChange={setOpen} title="Media tool" description="Test">
          <button>Tool action</button>
        </MediaToolDialog>
      </>
    );
  }
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  act(() => root.render(<Example />));
  const opener = document.querySelector("#root > button");
  act(() => {
    opener.focus();
    opener.click();
  });
  expect(document.querySelector('[role="dialog"]').contains(document.activeElement)).toBe(true);
  act(() => {
    if (method === "escape")
      document.activeElement.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    else document.querySelector('button[aria-label="Cerrar"]').click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
