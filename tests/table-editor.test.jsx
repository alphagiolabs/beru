import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import TableEditor from "../src/components/TableEditor.jsx";
import useKeyboard from "../src/hooks/useKeyboard.js";
import useEditorStore from "../src/stores/useEditorStore.js";

window.api = {
  startProcessing: vi.fn(async () => ({ success: true })),
  removeRecent: vi.fn(async () => ({ success: true, recent: [] })),
};
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

const queueItem = (filename, operations = []) => ({
  path: `C:\\videos\\${filename}`,
  src: "",
  filename,
  width: 1920,
  height: 1080,
  duration: 10,
  videoCodec: "",
  pixFmt: "yuv420p",
  frameRate: 30,
  audioCodec: "",
  operations,
  status: "idle",
  progress: 0,
  eta: null,
  speed: null,
  error: null,
  customOutputName: "",
  thumbnail: null,
});

function KeyboardHarness() {
  useKeyboard();
  return null;
}

function dispatchKey(target, key, init = {}) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
}

function focusedRowIndex() {
  const rows = Array.from(document.querySelectorAll("tbody tr"));
  return rows.findIndex((row) => {
    const cells = Array.from(row.querySelectorAll("td"));
    return cells.some((cell) => (cell.getAttribute("style") || "").includes("2px solid"));
  });
}

describe("TableEditor keyboard", () => {
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useEditorStore.setState({
      queue: [queueItem("1.mp4"), queueItem("2.mp4")],
      selectedIdx: 0,
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        { id: "region-2", label: "TEXT_2", region: { x: 0.1, y: 0.3, w: 0.2, h: 0.1 } },
      ],
      excelPath: null,
      excelHeaders: [],
      excelRows: [],
      excelMapping: { idColumn: null, columns: {} },
      excelMatchStatus: {},
      showTableEditor: true,
      textFontSize: 32,
      textFontColor: "white",
      fontFamily: "Arial",
      fontWeight: 400,
      letterSpacing: 0,
      textAlign: "left",
      textOpacity: 1,
      bold: false,
      italic: false,
      bgEnabled: true,
      bgColor: "black",
      bgOpacity: 0.65,
      boxBorderWidth: 4,
      borderWidth: 0,
      borderColor: "black",
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
  });

  it("focuses the grid on open and navigates rows with ArrowDown", () => {
    root = createRoot(document.getElementById("root"));

    act(() => {
      root.render(<TableEditor />);
    });

    const grid = document.querySelector('[tabindex="0"]');
    expect(document.activeElement).toBe(grid);
    expect(focusedRowIndex()).toBe(0);

    act(() => {
      dispatchKey(document.activeElement, "ArrowDown");
    });

    expect(focusedRowIndex()).toBe(1);
  });

  it("starts inline edit with Enter on the grid", () => {
    root = createRoot(document.getElementById("root"));

    act(() => {
      root.render(<TableEditor />);
    });

    const grid = document.querySelector('[tabindex="0"]');

    act(() => {
      grid.focus();
      dispatchKey(grid, "Enter");
    });

    expect(document.querySelector("tbody input")).toBeTruthy();
  });

  it("closes the table editor with Escape on the grid", () => {
    root = createRoot(document.getElementById("root"));

    act(() => {
      root.render(<TableEditor />);
    });

    const grid = document.querySelector('[tabindex="0"]');

    act(() => {
      grid.focus();
      dispatchKey(grid, "Escape");
    });

    expect(useEditorStore.getState().showTableEditor).toBe(false);
  });

  it("blocks global video shortcuts while the table editor is open", () => {
    root = createRoot(document.getElementById("root"));
    const videoCommands = [];
    const onVideoCommand = (e) => videoCommands.push(e.detail);
    window.addEventListener("beru:video:command", onVideoCommand);

    act(() => {
      root.render(
        <>
          <KeyboardHarness />
          <TableEditor />
        </>,
      );
    });

    try {
      act(() => {
        dispatchKey(window, " ");
        dispatchKey(window, "ArrowLeft");
        dispatchKey(window, "ArrowRight");
        dispatchKey(window, "ArrowUp");
        dispatchKey(window, "ArrowDown");
      });

      expect(videoCommands).toEqual([]);
    } finally {
      window.removeEventListener("beru:video:command", onVideoCommand);
    }
  });

  it("handles grid keys without leaking to window video shortcuts", () => {
    root = createRoot(document.getElementById("root"));
    const videoCommands = [];
    const onVideoCommand = (e) => videoCommands.push(e.detail);
    const onWindowKeydown = vi.fn();
    window.addEventListener("beru:video:command", onVideoCommand);
    window.addEventListener("keydown", onWindowKeydown);

    act(() => {
      root.render(
        <>
          <KeyboardHarness />
          <TableEditor />
        </>,
      );
    });

    const grid = document.querySelector('[tabindex="0"]');

    try {
      act(() => {
        dispatchKey(grid, "ArrowDown");
        dispatchKey(grid, "Enter");
      });

      const input = document.querySelector("tbody input");
      expect(input).toBeTruthy();

      act(() => {
        dispatchKey(input, "Escape");
      });

      expect(document.querySelector("tbody input")).toBeFalsy();

      act(() => {
        dispatchKey(grid, "Escape");
      });

      expect(videoCommands).toEqual([]);
      expect(onWindowKeydown).not.toHaveBeenCalled();
      expect(useEditorStore.getState().showTableEditor).toBe(false);
    } finally {
      window.removeEventListener("beru:video:command", onVideoCommand);
      window.removeEventListener("keydown", onWindowKeydown);
    }
  });

  it("closes the table editor with Escape via the global keyboard handler", () => {
    root = createRoot(document.getElementById("root"));

    act(() => {
      root.render(
        <>
          <KeyboardHarness />
          <TableEditor />
        </>,
      );
    });

    act(() => {
      dispatchKey(window, "Escape");
    });

    expect(useEditorStore.getState().showTableEditor).toBe(false);
  });
});
