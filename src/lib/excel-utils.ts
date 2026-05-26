/**
 * Excel batch import utilities.
 * Extracted from the main editor component to reduce monolith size.
 * These are pure helpers with no side effects.
 */

/** Strip the file extension from a filename: "clip_123.mp4" → "clip_123". */
export function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Case-insensitive lookup over the row's keys. Excel headers vary in
 *  capitalization (`id`, `Id`, `ID`, `iD`...) so we normalise on read. */
export function rowGet(row: Record<string, any>, ...keys: string[]): any {
  const lower: Record<string, any> = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase()] = row[k];
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Case-insensitive boolean lookup: accepts true/false, 1/0, "yes"/"no". */
export function rowGetBool(row: Record<string, any>, fallback: boolean, ...keys: string[]): boolean {
  const v = rowGet(row, ...keys);
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
}

/** Case-insensitive numeric lookup with clamp. Returns fallback if missing or non-finite. */
export function rowGetNum(row: Record<string, any>, fallback: number, ...keys: string[]): number {
  const v = rowGet(row, ...keys);
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Collision-free sequential ID generator based on existing operations. */
export function nextOpId(queue: { operations: { id: number }[] }[]): () => number {
  let maxId = 0;
  for (const item of queue) {
    for (const op of item.operations) {
      if (op.id > maxId) maxId = op.id;
    }
  }
  return () => ++maxId;
}

/** Generate a CSV template string for the subtitles import workflow. */
export function subtitleTemplateCsv(): string {
  return [
    'text,start,end,x,y,fontSize,fontColor,fontFamily,bold,italic,bgEnabled,bgColor,bgOpacity,borderWidth,borderColor',
    '"Hello world",0,3,,,32,white,Arial,false,false,true,black,0.65,0,black',
    '"Second line",3,6,,,32,white,,,,,,,',
  ].join('\n');
}

/** Generate a CSV template string for the text-by-ID import workflow. */
export function textByIdTemplateCsv(filenames: string[]): string {
  const header = 'id,text,fontSize,fontColor,fontFamily,bold,italic,bgEnabled,bgColor,bgOpacity,borderWidth,borderColor';
  const exampleRows = filenames.slice(0, 3).map(fn => {
    const id = stripExt(fn);
    return `"${id}","Sample text",32,white,Arial,false,false,true,black,0.65,0,black`;
  });
  if (exampleRows.length === 0) {
    exampleRows.push('"video_name","Sample text",32,white,Arial,false,false,true,black,0.65,0,black');
  }
  return [header, ...exampleRows].join('\n');
}

/** Trigger a CSV download in the browser. */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
