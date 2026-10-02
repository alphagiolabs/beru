import { describe, expect, it } from "vitest";
import es from "../src/i18n/messages/es.json";
import en from "../src/i18n/messages/en.json";

function flatten(dict, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

const esFlat = flatten(es);
const enFlat = flatten(en);

describe("i18n dictionaries", () => {
  it("exposes the same key set in both dictionaries", () => {
    const esKeys = Object.keys(esFlat).sort();
    const enKeys = Object.keys(enFlat).sort();
    expect(esKeys.filter((k) => !enFlat[k] && !(k in enFlat))).toEqual([]);
    expect(enKeys.filter((k) => !esFlat[k] && !(k in esFlat))).toEqual([]);
    expect(enKeys).toEqual(esKeys);
  });

  it("has no empty or non-string values", () => {
    for (const [dict, name] of [
      [esFlat, "es"],
      [enFlat, "en"],
    ]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, `${name}.${key}`).toBe("string");
        expect(value.trim(), `${name}.${key}`).not.toBe("");
      }
    }
  });

  it("keeps placeholder variables identical across dictionaries", () => {
    const varsOf = (str) => [...str.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(esFlat)) {
      expect(varsOf(enFlat[key]), key).toEqual(varsOf(esFlat[key]));
    }
  });
});
