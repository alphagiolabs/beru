import { useCallback } from "react";
import useEditorStore from "../stores/useEditorStore";
import { lookupMessage } from "../utils/format-message.js";
import es from "./messages/es.json";
import en from "./messages/en.json";

const DICTS = { es, en };

export function useT() {
  const lang = useEditorStore((s) => s.language) || "es";
  const dict = DICTS[lang] || es;
  return useCallback((key, vars) => lookupMessage(dict, key, vars, es), [dict]);
}

export const SUPPORTED_LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
];
