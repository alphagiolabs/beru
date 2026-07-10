import { useEffect } from "react";
import useEditorStore from "../../../stores/useEditorStore";

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!target.isContentEditable;
}

/**
 * Pet-only shortcuts. Mounted from BeruRoot so useKeyboard stays editor-pure.
 */
export default function usePetKeyboard() {
  useEffect(() => {
    const handler = (e) => {
      const store = useEditorStore.getState();
      const { key, ctrlKey, metaKey, shiftKey } = e;
      const cmd = ctrlKey || metaKey;

      if (key === "Escape" && store.showPetPalette) {
        store.setShowPetPalette(false);
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (store.showPetPalette) {
        e.stopImmediatePropagation();
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (store.showShortcuts || store.showTableEditor || store.showMappingModal) {
        return;
      }

      if (cmd && key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopImmediatePropagation();
        void store.ensurePetsReady?.().then(() => {
          useEditorStore.getState().setShowPetPalette(true);
        });
        return;
      }

      if (cmd && shiftKey && key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopImmediatePropagation();
        void store.ensurePetsReady?.().then(() => {
          const next = useEditorStore.getState();
          if (!next.petEnabled) {
            if (next.petActiveSlug) {
              void next.setPetEnabled(true);
            } else {
              const first = next.petInstalled?.[0]?.slug;
              if (first) void next.selectPet(first);
            }
            return;
          }
          void next.setPetEnabled(false);
        });
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);
}
