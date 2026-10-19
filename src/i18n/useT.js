import { useCallback } from "react";
import useEditorStore from "../stores/useEditorStore";
import { dictFor, lookupMessage } from "../utils/format-message.js";
import es from "./messages/es.json";

export function useT() {
  const lang = useEditorStore((s) => s.language) || "es";
  const dict = dictFor(lang);
  return useCallback((key, vars) => lookupMessage(dict, key, vars, es), [dict]);
}

export const SUPPORTED_LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
];
