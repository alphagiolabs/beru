import { useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";
import { selectTopmostModal } from "../stores/slices/uiSlice.js";
import { isTypingTarget } from "../utils/is-typing-target";

const TOOL_KEYS = {
  1: "blur",
  2: "crop",
  3: "text",
  4: "image",
  5: "delogo",
};

export default function useKeyboard() {
  useEffect(() => {
    const handler = (e) => {
      const store = useEditorStore.getState();
      const { key, ctrlKey, metaKey, shiftKey, altKey } = e;
      const cmd = ctrlKey || metaKey;

      const modal = selectTopmostModal(store);
      if (modal === "showCompositionModal" || modal === "showStabilizationModal") return;
      if (store.sidebarMode === "editor" && key !== "Escape") return;

      if (key === "Escape" && modal) {
        if (modal === "showTableEditor" && isTypingTarget(e.target)) e.target.blur();
        else store.closeTopmostModal();
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (key === "Escape") {
        if (store.currentRegion) {
          store.setCurrentRegion(null);
          return;
        }
        if (store.selectedOperationIdx != null) {
          store.selectOperation(null);
          return;
        }
        return;
      }

      if (modal) return;

      if (key === "?" && !cmd) {
        e.preventDefault();
        store.setShowShortcuts(!store.showShortcuts);
        return;
      }

      if (cmd && !shiftKey && key.toLowerCase() === "z") {
        e.preventDefault();
        store.undo();
        return;
      }
      if (cmd && (key.toLowerCase() === "y" || (shiftKey && key.toLowerCase() === "z"))) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (cmd && key.toLowerCase() === "s") {
        e.preventDefault();
        store.saveProject();
        return;
      }
      if (cmd && key.toLowerCase() === "o") {
        e.preventDefault();
        store.loadProject();
        return;
      }

      if (!cmd && !shiftKey && !altKey && TOOL_KEYS[key]) {
        if (store.sidebarMode === "logo" && store.editorWorkspace === "logo") {
          e.preventDefault();
          store.setActiveTool(TOOL_KEYS[key]);
          return;
        }
      }

      if (key === " " || key === "Spacebar") {
        if (store.queue.length === 0) return;
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("beru:video:command", { detail: { type: "toggle-play" } }),
        );
        return;
      }
      if (key === "ArrowLeft") {
        e.preventDefault();
        const step = shiftKey ? 1 : 5;
        window.dispatchEvent(
          new CustomEvent("beru:video:command", { detail: { type: "seek", delta: -step } }),
        );
        return;
      }
      if (key === "ArrowRight") {
        e.preventDefault();
        const step = shiftKey ? 1 : 5;
        window.dispatchEvent(
          new CustomEvent("beru:video:command", { detail: { type: "seek", delta: step } }),
        );
        return;
      }
      if (key === "Home") {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("beru:video:command", { detail: { type: "seek-abs", value: 0 } }),
        );
        return;
      }
      if (key === "End") {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("beru:video:command", { detail: { type: "seek-abs", value: 1 } }),
        );
        return;
      }

      if (key === "[" || (key === "ArrowUp" && !cmd)) {
        if (store.queue.length === 0) return;
        e.preventDefault();
        store.selectVideo(Math.max(0, store.selectedIdx - 1));
        return;
      }
      if (key === "]" || (key === "ArrowDown" && !cmd)) {
        if (store.queue.length === 0) return;
        e.preventDefault();
        store.selectVideo(Math.min(store.queue.length - 1, store.selectedIdx + 1));
        return;
      }

      if (key === "n" && !cmd) {
        e.preventDefault();
        store.setCurrentRegion(null);
        return;
      }
      if ((key === "Delete" || key === "Backspace") && !cmd) {
        if (store.currentRegion) {
          e.preventDefault();
          store.setCurrentRegion(null);
          return;
        }
        const selOpIdx = store.selectedOperationIdx;
        const selOp =
          selOpIdx != null ? store.queue[store.selectedIdx]?.operations?.[selOpIdx] : null;
        if (
          selOp &&
          (selOp.mode === "blur" ||
            selOp.mode === "delogo" ||
            selOp.mode === "crop" ||
            selOp.mode === "image" ||
            selOp.mode === "datetime")
        ) {
          e.preventDefault();
          store.removeOperation(selOpIdx);
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
