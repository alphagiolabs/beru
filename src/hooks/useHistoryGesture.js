import { useRef } from "react";
import useEditorStore from "../stores/useEditorStore.js";

export default function useHistoryGesture(key = "") {
  const gesture = useRef(null);
  return {
    apply(change) {
      const state = useEditorStore.getState();
      const owner = `${state.selectedIdx}:${state.queue[state.selectedIdx]?.path}:${key}`;
      const changed = change({
        recordHistory:
          gesture.current?.owner !== owner || gesture.current?.stack !== state.undoStack,
      });
      if (changed !== false)
        gesture.current = { owner, stack: useEditorStore.getState().undoStack };
      return changed;
    },
    end() {
      gesture.current = null;
    },
  };
}
