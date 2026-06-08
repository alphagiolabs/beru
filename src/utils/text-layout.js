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

export function elementOverflows(el, tolerance = 1) {
  if (!el) return false;
  return (
    el.scrollHeight > el.clientHeight + tolerance || el.scrollWidth > el.clientWidth + tolerance
  );
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
export function estimateCharWidthPx(fontSizePx) {
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
