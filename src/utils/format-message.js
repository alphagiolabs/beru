import es from "../i18n/messages/es.json";
import en from "../i18n/messages/en.json";

const DICTS = { es, en };

export function lookupMessage(dict, key, vars, fallbackDict) {
  let str = dict[key];
  if (str == null) str = fallbackDict[key] != null ? fallbackDict[key] : key;
  if (vars && typeof str === "string") {
    str = str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }
  return str;
}

export function tStatic(key, vars, lang) {
  const l = lang || "es";
  const dict = DICTS[l] || es;
  return lookupMessage(dict, key, vars, es);
}
