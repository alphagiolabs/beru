export const VERTICAL_ALIGNS = [
  { value: "top", label: "↑" },
  { value: "center", label: "↕" },
  { value: "bottom", label: "↓" },
];

export const TRUNCATE_MODES = [
  {
    value: "none",
    labelKey: "catalog.truncate.none.label",
    titleKey: "catalog.truncate.none.title",
  },
  {
    value: "ellipsis",
    labelKey: "catalog.truncate.ellipsis.label",
    titleKey: "catalog.truncate.ellipsis.title",
  },
  {
    value: "clip",
    labelKey: "catalog.truncate.clip.label",
    titleKey: "catalog.truncate.clip.title",
  },
];

export function verticalAlignToFlex(verticalAlign) {
  return { top: "flex-start", center: "center", bottom: "flex-end" }[verticalAlign] || "flex-start";
}

export function scaledSafeMargin(safeMargin, scale = 1) {
  return Math.max(0, Number(safeMargin) || 0) * scale;
}

export function textBgEnabled(op = {}) {
  const bg = op.bg_enabled ?? op.bgEnabled;
  if (typeof bg === "string") {
    return !["0", "false", "no"].includes(bg.toLowerCase());
  }
  if (bg === undefined || bg === null) return true;
  return Boolean(bg);
}

export function textBoxPad(op = {}) {
  if (!textBgEnabled(op)) return 0;
  const raw = op.box_border_width ?? op.boxBorderWidth ?? 4;
  const boxPad = Number.parseInt(raw, 10);
  return Math.max(0, Number.isFinite(boxPad) ? boxPad : 4);
}

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

function estimateCharWidthPx(fontSizePx) {
  const fontSize = Number(fontSizePx);
  const size = Number.isFinite(fontSize) ? fontSize : 32;
  return Math.max(4, size * 0.55);
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function wrapTextToWidth(text, maxWidthPx, fontSizePx) {
  const raw = String(text ?? "");
  if (!raw || maxWidthPx <= 0) return raw;
  const maxChars = Math.max(1, Math.trunc(maxWidthPx / estimateCharWidthPx(fontSizePx)));
  const longestLine = raw.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
  if (longestLine <= maxChars) return raw;
  const lines = [];
  for (const paragraph of raw.split("\n")) {
    const tokens = paragraph.split(/(\s+)/);
    let line = "";
    for (const token of tokens) {
      if (!token) continue;
      const next = line + token;
      if (next.length <= maxChars || !line) line = next;
      else {
        if (line.trim()) lines.push(line.trimEnd());
        line = token.trimStart();
      }
    }
    if (line || paragraph === "") {
      lines.push(line.trimEnd());
    }
  }
  return lines.join("\n");
}

export function truncateText(text, maxWidthPx, fontSizePx, mode) {
  const raw = String(text ?? "");
  if (mode !== "ellipsis" || !raw || maxWidthPx <= 0) return raw;
  const maxChars = Math.max(1, Math.trunc(maxWidthPx / estimateCharWidthPx(fontSizePx)));
  if (raw.replace(/\n/g, "").length <= maxChars) return raw;
  const keep = Math.max(1, maxChars - 1);
  return `${raw.slice(0, keep).trimEnd()}…`;
}

export function fitFontSize(text, regionW, regionH, baseSize, lineHeight, wrap, minSize = 8) {
  let size = toInt(baseSize, 32);
  let lh = Number(lineHeight);
  if (!Number.isFinite(lh)) lh = 1.2;
  const width = toInt(regionW, 0);
  const height = toInt(regionH, 0);
  minSize = Math.max(8, toInt(minSize, 8));
  size = Math.max(minSize, size);
  if (width <= 0 || height <= 0) return size;

  const fits = (fontSize) => {
    const display = wrap ? wrapTextToWidth(text, width, fontSize) : String(text ?? "");
    const lineCount = display ? Math.max(1, display.split("\n").length) : 1;
    const longest = display.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
    return lineCount * fontSize * lh <= height && longest * estimateCharWidthPx(fontSize) <= width;
  };

  if (fits(size)) return size;
  return binarySearchAutoFitFontSize(fits, { minPx: minSize, maxPx: size - 1 });
}

export function layoutExportText({
  text,
  regionW,
  regionH,
  fontSize = 32,
  lineHeight = 1.2,
  textWrap = true,
  autoFit = false,
  truncate = "none",
} = {}) {
  const raw = String(text ?? "");
  const wrap =
    typeof textWrap === "string"
      ? !["0", "false", "no"].includes(textWrap.toLowerCase())
      : textWrap !== false;
  const auto = Boolean(autoFit);
  const mode = String(truncate || "none").toLowerCase();
  let lh = Number(lineHeight);
  if (!Number.isFinite(lh)) lh = 1.2;
  const width = toInt(regionW, 0);
  const height = toInt(regionH, 0);

  let size;
  if (auto && width > 0 && height > 0) {
    size = fitFontSize(raw, width, height, fontSize, lh, wrap);
  } else {
    size = toInt(fontSize, 32);
  }

  let display = raw;
  if (wrap && width > 0) display = wrapTextToWidth(raw, width, size);
  if (!auto) display = truncateText(display, width, size, mode);
  return { fontSize: size, displayText: display };
}

export function exportTextOverflows(displayText, fontSize, lineHeight, regionW, regionH) {
  const display = String(displayText ?? "");
  if (!display) return false;
  const width = toInt(regionW, 0);
  const height = toInt(regionH, 0);
  if (width <= 0 || height <= 0) return true;
  let lh = Number(lineHeight);
  if (!Number.isFinite(lh)) lh = 1.2;
  const lines = display.split("\n");
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return lines.length * fontSize * lh > height || longest * estimateCharWidthPx(fontSize) > width;
}

export function drawtextLineSpacingPx(fontSize, lineHeight = 1.2) {
  const size = Number(fontSize);
  const lh = Number(lineHeight);
  if (!Number.isFinite(size) || !Number.isFinite(lh)) return 0;
  return Math.round(size * Math.max(0, lh - 1));
}
