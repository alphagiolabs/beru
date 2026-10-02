import { useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";

export default function useProcessing(api) {
  useEffect(() => {
    if (!api) return;
    return useEditorStore.getState().connectProcessing(api);
  }, [api]);
}
