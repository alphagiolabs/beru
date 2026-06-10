import { useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";

const TOOL_KEYS = {
  1: "blur",
  2: "crop",
  3: "text",
  4: "image",
  5: "delogo",
};

const isTypingTarget = (target) => {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
};

export default function useKeyboard() {
  useEffect(() => {
    const handler = (e) => {
      const store = useEditorStore.getState();
      const { key, ctrlKey, metaKey, shiftKey, altKey } = e;
      const cmd = ctrlKey || metaKey;

      if (key === "Escape") {
        if (store.showShortcuts) {
          store.setShowShortcuts(false);
          return;
        }
        if (store.showTableEditor) {
          store.setShowTableEditor(false);
          return;
        }
        if (store.showMappingModal) {
          store.setShowMappingModal(false);
          return;
        }
      }

      if (isTypingTarget(e.target)) return;

      // Modals
      if (key === "Escape") {
        if (store.currentRegion) {
          store.setCurrentRegion(null);
          return;
        }
        return;
      }

      if (store.showShortcuts || store.showTableEditor || store.showMappingModal) {
        return;
      }

      if (key === "?" && !cmd) {
        e.preventDefault();
        store.setShowShortcuts(!store.showShortcuts);
        return;
      }

      // Project / history
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

      // Tool selection (1-5)
      if (!cmd && !shiftKey && !altKey && TOOL_KEYS[key]) {
        if (store.sidebarMode === "logo") {
          e.preventDefault();
          store.setActiveTool(TOOL_KEYS[key]);
          return;
        }
      }

      // Playback
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

      // Queue navigation
      if (key === "[" || (key === "ArrowUp" && !cmd)) {
        e.preventDefault();
        if (store.queue.length === 0) return;
        store.selectVideo(Math.max(0, store.selectedIdx - 1));
        return;
      }
      if (key === "]" || (key === "ArrowDown" && !cmd)) {
        e.preventDefault();
        if (store.queue.length === 0) return;
        store.selectVideo(Math.min(store.queue.length - 1, store.selectedIdx + 1));
        return;
      }

      // Region / op
      if (key === "n" && !cmd) {
        e.preventDefault();
        store.setCurrentRegion(null);
        return;
      }
      if ((key === "Delete" || key === "Backspace") && !cmd) {
        if (store.currentRegion) {
          e.preventDefault();
          store.setCurrentRegion(null);
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
