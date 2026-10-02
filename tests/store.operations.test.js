import { describe, it, expect, beforeEach } from "vitest";
import { createMockApi, installMockApi, makeQueueItem, resetEditorState } from "./helpers/store.js";

const mockApi = installMockApi(createMockApi());

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("operation editing (undo + addOperation)", () => {
  beforeEach(() => resetEditorState(useEditorStore, mockApi));

  it("live region drag can skip undo snapshots (recordHistory: false)", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      selectedIdx: 0,
      undoStack: [],
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              region: { ...region },
              text: "A",
            },
          ],
        }),
      ],
    });

    useEditorStore.getState()._saveUndo();
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    for (let i = 0; i < 20; i++) {
      useEditorStore
        .getState()
        .updateOperation(
          0,
          0,
          { region: { ...region, x: 0.1 + i * 0.01 } },
          { recordHistory: false },
        );
      useEditorStore
        .getState()
        .updateOperationRegion(0, { ...region, x: 0.1 + i * 0.01 }, { recordHistory: false });
    }

    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(useEditorStore.getState().queue[0].operations[0].region.x).toBeCloseTo(0.29, 5);

    useEditorStore.getState().updateOperationRegion(0, { ...region, x: 0.5 });
    expect(useEditorStore.getState().undoStack).toHaveLength(2);
  });

  it("addOperation rejects image and empty text ops in logo mode", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [makeQueueItem()],
      selectedIdx: 0,
      currentRegion: region,
      textInput: "   ",
      tempImagePath: "",
    });

    useEditorStore.getState().addOperation("image");
    useEditorStore.getState().addOperation("text");
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(0);

    useEditorStore.setState({ textInput: "Hola", tempImagePath: "C:\\img\\logo.png" });
    useEditorStore.getState().addOperation("text");
    useEditorStore.setState({ currentRegion: region });
    useEditorStore.getState().addOperation("image");
    const ops = useEditorStore.getState().queue[0].operations;
    expect(ops).toHaveLength(2);
    expect(ops[0].mode).toBe("text");
    expect(ops[0].text).toBe("Hola");
    expect(ops[1].mode).toBe("image");
    expect(ops[1].imagePath).toBe("C:\\img\\logo.png");
  });
});
