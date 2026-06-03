import path from "path";
import fs from "fs";

export function readPresetsFromDir(dir, source) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".beru.json") && !name.toLowerCase().endsWith(".json"))
      continue;
    const full = path.join(dir, name);
    try {
      const raw = fs.readFileSync(full, "utf8");
      const data = JSON.parse(raw);
      if (data && (data.type === "beru-preset" || data.type === "beru-project")) {
        out.push({
          name: data.name || name.replace(/\.beru\.json$|\.json$/i, ""),
          description: data.description || "",
          filename: name,
          source,
          data,
        });
      }
    } catch (e) {
      console.error(`[beru] Failed to read preset ${full}:`, e.message);
    }
  }
  return out;
}
