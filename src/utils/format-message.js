import es from "../i18n/messages/es.json";
import en from "../i18n/messages/en.json";

const DICTS = { es, en };

/** Resolve an i18n key outside React (e.g. IPC hooks). */
export function tStatic(key, vars, lang) {
  const l = lang || "es";
  const dict = DICTS[l] || es;
  let str = dict[key];
  if (str == null) str = es[key] != null ? es[key] : key;
  if (vars && typeof str === "string") {
    str = str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }
  return str;
}