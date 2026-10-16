import { selectIsDirty, useTimelineStore } from "./useTimelineStore.js";
import { swallow } from "../../../utils/swallow.js";

const AUTOSAVE_DELAY_MS = 2000;

export function writeAutosave(api, state = useTimelineStore.getState()) {
  const { history, revision } = state;
  return api.writeEditorAutosave({ project: { ...history.present, revision } });
}

export function connectEditorAutosave(api) {
  if (!api?.writeEditorAutosave) return;
  let timer;
  let queuedProject = null;
  let writing = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    const state = useTimelineStore.getState();
    if (!selectIsDirty(state) || state.history.present === queuedProject) return writing;
    const project = state.history.present;
    queuedProject = project;
    writing = writing
      .then(() => {
        const current = useTimelineStore.getState();
        if (state.documentOwner !== current.documentOwner || current.cleanProject === project)
          return;
        return writeAutosave(api, state);
      })
      .then((result) => {
        if (result?.success === false) throw new Error(result.error || "Autosave failed");
      })
      .catch((error) => {
        if (queuedProject === project) queuedProject = null;
        swallow("Editor autosave", error);
      });
    return writing;
  };
  const schedule = (state, previous) => {
    if (
      state.history.present === previous?.history.present &&
      state.revision === previous?.revision
    )
      return;
    clearTimeout(timer);
    if (selectIsDirty(state)) timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };
  const unsubscribe = useTimelineStore.subscribe(schedule);
  const onHidden = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  schedule(useTimelineStore.getState());
  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", onHidden);
  return () => {
    unsubscribe();
    window.removeEventListener("beforeunload", flush);
    document.removeEventListener("visibilitychange", onHidden);
    void flush();
  };
}
