import { create } from "zustand";
import { createEmptyEditorProject, EditorError } from "../../../../shared/editor-project.js";
import { setVideoPathOwners } from "../../../utils/video-path-ownership.js";
import {
  beginGesture,
  cancelGesture,
  commit,
  createHistory,
  endGesture,
  previewGesture,
  redo,
  undo,
} from "./history.js";

const withRevision = (state, history) => ({
  history,
  revision: state.revision + 1,
  lastError: null,
});

export const useTimelineStore = create((set, get) => {
  const failWith = (error) => {
    if (!(error instanceof EditorError)) throw error;
    set({ lastError: error.message });
    return false;
  };

  const initial = createEmptyEditorProject();

  return {
    documentOwner: {},
    history: createHistory(initial),
    revision: initial.revision,
    savedRevision: null,
    cleanProject: initial,
    lastError: null,
    filePath: null,
    assetStatus: {},
    previewPaths: {},
    proxyRequests: {},

    open(project, { filePath = null, assetStatus = {} } = {}) {
      set({
        documentOwner: {},
        history: createHistory(project),
        revision: project.revision,
        savedRevision: project.revision,
        cleanProject: project,
        lastError: null,
        filePath,
        assetStatus,
        previewPaths: {},
        proxyRequests: {},
      });
    },

    setAssetStatus(assetStatus) {
      set({ assetStatus });
    },

    restoreUnsaved(project) {
      set({
        documentOwner: {},
        history: createHistory(project),
        revision: project.revision,
        savedRevision: null,
        cleanProject: null,
        lastError: null,
        filePath: null,
        assetStatus: {},
        previewPaths: {},
        proxyRequests: {},
      });
    },

    setPreviewPath(assetId, path) {
      set((state) => ({ previewPaths: { ...state.previewPaths, [assetId]: path } }));
    },

    requestProxy(assetId) {
      if (get().proxyRequests[assetId]) return false;
      set((state) => ({ proxyRequests: { ...state.proxyRequests, [assetId]: true } }));
      return true;
    },

    clearError() {
      set({ lastError: null });
    },

    apply(operation) {
      try {
        const next = operation(get().history.present);
        set((state) => withRevision(state, commit(state.history, next)));
        return true;
      } catch (error) {
        return failWith(error);
      }
    },

    beginGesture() {
      set((state) => ({ history: beginGesture(state.history) }));
    },

    preview(operation) {
      try {
        const next = operation(get().history.present);
        set((state) => ({ history: previewGesture(state.history, next) }));
        return true;
      } catch (error) {
        return failWith(error);
      }
    },

    endGesture() {
      const before = get().history;
      const after = endGesture(before);
      if (after === before) return;
      set((state) => withRevision(state, after));
    },

    cancelGesture() {
      set((state) => ({ history: cancelGesture(state.history) }));
    },

    undo() {
      const before = get().history;
      const after = undo(before);
      if (after !== before) set((state) => withRevision(state, after));
    },

    redo() {
      const before = get().history;
      const after = redo(before);
      if (after !== before) set((state) => withRevision(state, after));
    },

    markSaved({ project, revision, filePath }) {
      set({
        cleanProject: project,
        savedRevision: revision,
        ...(filePath ? { filePath } : {}),
      });
    },
  };
});

export const selectIsDirty = (state) => state.history.present !== state.cleanProject;

useTimelineStore.subscribe((state, previous) => {
  if (state.history === previous.history) return;
  const { present, past, future, gesture } = state.history;
  const projects = [present, ...past, ...future, ...(gesture ? [gesture.base] : [])];
  const libraries = new Set(projects.map((project) => project.assets));
  setVideoPathOwners({
    montage: [...libraries].flatMap((assets) =>
      assets.filter((asset) => asset.metadata.durationUs != null).map((asset) => asset.path),
    ),
  });
});
