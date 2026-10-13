import { useEffect, useRef, useState } from "react";
import useEditorStore from "../../stores/useEditorStore.js";
import { useT } from "../../i18n/useT.js";

export function useCompositionDocumentIO({ open, document, onLoaded, onError }) {
  const t = useT(),
    get = useEditorStore.getState;
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    sequence.current += 1;
    setBusy(false);
    return () => {
      sequence.current += 1;
    };
  }, [open, document]);

  const execute = async (request, apply) => {
    const token = ++sequence.current,
      owner = document;
    const current = () =>
      token === sequence.current &&
      get().showCompositionModal &&
      !get().isProcessing &&
      get().composition === owner;
    setBusy(true);
    try {
      const response = await request();
      if (!current()) return;
      if (response?.success) apply?.(response);
      else if (!response?.canceled) onError();
    } catch {
      if (current()) onError();
    } finally {
      if (token === sequence.current) setBusy(false);
    }
  };
  return {
    busy,
    load: () =>
      execute(
        () =>
          window.api.loadComposition({
            loadTitle: t("composition.load"),
            filterName: t("composition.title"),
          }),
        (response) => {
          if (get().restoreComposition(response.document)) onLoaded();
          else onError();
        },
      ),
    save: () =>
      execute(() =>
        window.api.saveComposition(document, {
          saveTitle: t("composition.save"),
          filterName: t("composition.title"),
        }),
      ),
    chooseOutput: () =>
      execute(
        async () => {
          const directory = await window.api.selectOutputDir();
          return { success: Boolean(directory), canceled: !directory, directory };
        },
        (response) => get().setOutputDir(response.directory),
      ),
  };
}
