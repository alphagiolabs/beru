import { uid } from "../../utils/types.js";
import { releaseUnownedVideoPaths } from "../../utils/video-path-ownership.js";
import {
  newComposition,
  compositionItem,
  parseCompositionDocument,
} from "../../utils/composition.js";

export function createCompositionSlice(set, get) {
  const edit = (update) => {
    if (get().isProcessing) return false;
    const previous = get().composition;
    const next = parseCompositionDocument(update(previous));
    if (!next) return false;
    set({ composition: next });
    releaseUnownedVideoPaths(previous?.entries.map((entry) => entry.item.path) || [], get());
    return true;
  };
  return {
    composition: null,
    showCompositionModal: false,
    setShowCompositionModal: (show) => set({ showCompositionModal: show }),
    addCompositionEntry: (index) => {
      const item = compositionItem(get().queue[index]);
      if (!item) return false;
      return edit((document) => {
        const current = document || newComposition(item);
        return { ...current, entries: [...current.entries, { id: uid(), item }] };
      });
    },
    removeCompositionEntry: (id) =>
      edit((document) => ({
        ...document,
        entries: document.entries.filter((entry) => entry.id !== id),
      })),
    moveCompositionEntry: (id, delta) =>
      edit((document) => {
        const entries = [...document.entries],
          index = entries.findIndex((entry) => entry.id === id),
          target = index + delta;
        if (index < 0 || target < 0 || target >= entries.length) return document;
        [entries[index], entries[target]] = [entries[target], entries[index]];
        return { ...document, entries };
      }),
    editCompositionEntry: (id, patch) =>
      edit((document) => ({
        ...document,
        entries: document.entries.map((entry) =>
          entry.id === id ? { ...entry, item: { ...entry.item, ...patch } } : entry,
        ),
      })),
    setCompositionSettings: (patch) => edit((document) => ({ ...document, ...patch })),
    restoreComposition: (document) => edit(() => document),
  };
}
