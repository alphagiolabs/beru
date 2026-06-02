import useEditorStore from "../stores/useEditorStore";
import es from "./messages/es.json";
import en from "./messages/en.json";

const DICTS = { es, en };

export function useT() {
  const lang = useEditorStore((s) => s.language) || "es";
  const dict = DICTS[lang] || es;
  return (key, vars) => {
    let str = dict[key];
    if (str == null) str = es[key] != null ? es[key] : key;
    if (vars && typeof str === "string") {
      str = str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    }
    return str;
  };
}

export const SUPPORTED_LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
];
