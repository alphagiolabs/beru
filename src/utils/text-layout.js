/** Layout helpers for text overlays (preview measurement + export estimates). */

export const VERTICAL_ALIGNS = [
  { value: "top", label: "↑" },
  { value: "center", label: "↕" },
  { value: "bottom", label: "↓" },
];

export const TRUNCATE_MODES = [
  { value: "none", label: "Ninguno" },
  { value: "ellipsis", label: "…" },
  { value: "clip", label: "Recortar" },
];

export function verticalAlignToFlex(verticalAlign) {
  return { top: "flex-start", center: "center", bottom: "flex-end" }[verticalAlign] || "flex-start";
}

export function scaledSafeMargin(safeMargin, scale = 1) {
  return Math.max(0, Number(safeMargin) || 0) * scale;
}

/** Match Python `_text_bg_enabled` (op may use snake_case). */
export function textBgEnabled(op = {}) {
  const bg = op.bg_enabled ?? op.bgEnabled;
  if (typeof bg === "string") {
    return !["0", "false", "no"].includes(bg.toLowerCase());
  }
  if (bg === undefined || bg === null) return true;
  return Boolean(bg);
}

/** Match Python `_text_box_pad` (op may use snake_case). */
export function textBoxPad(op = {}) {
  if (!textBgEnabled(op)) return 0;
  const raw = op.box_border_width ?? op.boxBorderWidth ?? 4;
  const boxPad = Number.parseInt(raw, 10);
  return Math.max(0, Number.isFinite(boxPad) ? boxPad : 4);
}

/** Usable text area inside a region — matches Python `_text_layout_bounds`. */
export function textLayoutBounds(region = {}, safeMargin = 0, boxPad = 0) {
  const rx = Math.trunc(Number(region.x) || 0);
  const ry = Math.trunc(Number(region.y) || 0);
  const rw = Math.trunc(Number(region.w) || 0);
  const rh = Math.trunc(Number(region.h) || 0);
  const inset = Math.max(0, Number(safeMargin) || 0) + Math.max(0, Number(boxPad) || 0);
  return {
    x: rx + inset,
    y: ry + inset,
    w: Math.max(0, rw - 2 * inset),
    h: Math.max(0, rh - 2 * inset),
  };
}

export function getTextLayoutCss(style = {}) {
  const textWrap = style.textWrap !== false;
  const truncate = style.truncate || "none";

  const base = {
    lineHeight: style.lineHeight ?? 1.2,
    width: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    margin: 0,
    boxSizing: "border-box",
  };

  if (!textWrap) {
    return {
      ...base,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: truncate === "ellipsis" ? "ellipsis" : "clip",
    };
  }

  return {
    ...base,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowWrap: "break-word",
    overflow: truncate === "none" ? "visible" : "hidden",
    textOverflow: truncate === "ellipsis" ? "ellipsis" : undefined,
  };
}

export function elementOverflows(el, tolerance = 1, bounds = null) {
  if (!el) return false;
  const maxWidth =
    bounds && Number.isFinite(bounds.width) ? Math.max(0, bounds.width) : el.clientWidth;
  const maxHeight =
    bounds && Number.isFinite(bounds.height) ? Math.max(0, bounds.height) : el.clientHeight;
  return el.scrollHeight > maxHeight + tolerance || el.scrollWidth > maxWidth + tolerance;
}

/** Largest font size (px) that fits inside the measured element. */
export function binarySearchAutoFitFontSize(measureFits, { minPx, maxPx }) {
  let lo = minPx;
  let hi = maxPx;
  let best = minPx;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (measureFits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Rough char width for export-side wrapping (matches processor.py heuristic). */
function estimateCharWidthPx(fontSizePx) {
  return Math.max(4, fontSizePx * 0.55);
}

/** Word-wrap to estimated line count for export previews/tests. */
export function wrapTextToWidth(text, maxWidthPx, fontSizePx) {
  const raw = String(text ?? "");
  if (!raw || maxWidthPx <= 0) return raw;
  const maxChars = Math.max(1, Math.floor(maxWidthPx / estimateCharWidthPx(fontSizePx)));
  const lines = [];
  for (const paragraph of raw.split("\n")) {
    const words = paragraph.split(/(\s+)/);
    let line = "";
    for (const token of words) {
      if (!token) continue;
      const next = line + token;
      if (next.length <= maxChars || !line) line = next;
      else {
        if (line.trim()) lines.push(line.trimEnd());
        line = token.trimStart();
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
    else if (paragraph === "") lines.push("");
  }
  return lines.join("\n");
}
