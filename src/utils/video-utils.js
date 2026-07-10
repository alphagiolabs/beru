/* ── Video utilities ────────────────────────────────────────────────── */

/* Regions are stored NORMALIZED (0..1) where 1.0 = full video dimension.
 * This lets a single region be reused across videos of any resolution. */

const MIN_REGION_SIZE = 0.01;

export function isRegionUsable(region, minSize = MIN_REGION_SIZE) {
  return (
    !!region &&
    Number.isFinite(region.x) &&
    Number.isFinite(region.y) &&
    Number.isFinite(region.w) &&
    Number.isFinite(region.h) &&
    Math.abs(region.w) >= minSize &&
    Math.abs(region.h) >= minSize
  );
}

export function clampRegionToVideo(region, maxX = 1, maxY = 1, minSize = MIN_REGION_SIZE) {
  if (!region || ![region.x, region.y, region.w, region.h].every(Number.isFinite)) return null;
  let { x, y, w, h } = region;
  if (w < 0) {
    x += w;
    w = Math.abs(w);
  }
  if (h < 0) {
    y += h;
    h = Math.abs(h);
  }
  x = Math.max(0, x);
  y = Math.max(0, y);
  w = Math.max(minSize, w);
  h = Math.max(minSize, h);
  if (maxX > 0) {
    w = Math.min(Math.max(w, Math.min(minSize, maxX)), maxX);
    x = Math.min(x, Math.max(0, maxX - w));
  }
  if (maxY > 0) {
    h = Math.min(Math.max(h, Math.min(minSize, maxY)), maxY);
    y = Math.min(y, Math.max(0, maxY - h));
  }
  return { x, y, w, h };
}

export function contentRect(videoEl) {
  if (!videoEl) return null;
  const br = videoEl.getBoundingClientRect();
  if (br.width === 0 || br.height === 0) return null;
  const vr = videoEl.videoWidth / videoEl.videoHeight;
  const cr = br.width / br.height;
  let dw, dh, ox, oy;
  if (vr > cr) {
    dw = br.width;
    dh = br.width / vr;
    ox = 0;
    oy = (br.height - dh) / 2;
  } else {
    dh = br.height;
    dw = br.height * vr;
    ox = (br.width - dw) / 2;
    oy = 0;
  }
  return { dw, dh, ox, oy, br };
}

export function contentRectLayout(videoEl) {
  if (!videoEl) return null;
  const w = videoEl.offsetWidth;
  const h = videoEl.offsetHeight;
  if (w === 0 || h === 0) return null;
  const vr = videoEl.videoWidth / videoEl.videoHeight;
  const cr = w / h;
  let dw, dh, ox, oy;
  if (vr > cr) {
    dw = w;
    dh = w / vr;
    ox = 0;
    oy = (h - dh) / 2;
  } else {
    dh = h;
    dw = h * vr;
    ox = (w - dw) / 2;
    oy = 0;
  }
  return { dw, dh, ox, oy, width: w, height: h };
}

export function toVideoCoordsNormalized(videoEl, cx, cy) {
  const c = contentRect(videoEl);
  if (!c || !videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return null;
  return {
    x: Math.max(0, Math.min((cx - c.br.left - c.ox) / c.dw, 1)),
    y: Math.max(0, Math.min((cy - c.br.top - c.oy) / c.dh, 1)),
  };
}

export function regionToScreen(region, videoEl) {
  if (!region || !videoEl) return null;
  const c = contentRectLayout(videoEl);
  if (!c || !videoEl.videoWidth || !videoEl.videoHeight) return null;
  const sx = c.dw / videoEl.videoWidth;
  const sy = c.dh / videoEl.videoHeight;
  const px = region.x * videoEl.videoWidth;
  const py = region.y * videoEl.videoHeight;
  const pw = region.w * videoEl.videoWidth;
  const ph = region.h * videoEl.videoHeight;
  return {
    x: px * sx + c.ox,
    y: py * sy + c.oy,
    w: pw * sx,
    h: ph * sy,
    sx,
    sy,
  };
}

export function drawRegionOnCanvas(
  canvas,
  videoEl,
  region,
  tool = "blur",
  delogoMethod = "inpaint",
) {
  if (!canvas || !videoEl) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.max(1, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  if (typeof ctx.setTransform === "function") {
    if (
      canvas.width !== Math.round(canvas.clientWidth * dpr) ||
      canvas.height !== Math.round(canvas.clientHeight * dpr)
    ) {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (!region) return;
  const c = contentRectLayout(videoEl);
  if (!c || !videoEl.videoWidth || !videoEl.videoHeight) return;
  const sx = c.dw / videoEl.videoWidth;
  const sy = c.dh / videoEl.videoHeight;
  const px = region.x * videoEl.videoWidth;
  const py = region.y * videoEl.videoHeight;
  const pw = region.w * videoEl.videoWidth;
  const ph = region.h * videoEl.videoHeight;
  const x = px * sx + c.ox;
  const y = py * sy + c.oy;
  const w = pw * sx;
  const h = ph * sy;

  if (tool === "crop") {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.clientWidth, y);
    ctx.fillRect(0, y + h, canvas.clientWidth, canvas.clientHeight - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, canvas.clientWidth - x - w, h);
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  } else if (tool === "delogo") {
    /* The actual visual effect is rendered live by DelogoLivePreview
       (canvas for temporal/mirror/mosaic/inpaint, CSS for blur/fill).
       Here we only draw the selection border so the user can see
       the region bounds on top of the preview. */
    ctx.strokeStyle = "rgba(244,63,94,0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  } else if (tool === "text") {
    // Outline only — a translucent fill was covering the live text preview
    // underneath the canvas (z-index) and looked like the text "disappeared".
    ctx.strokeStyle = "rgba(168,85,247,0.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = "rgba(0,240,234,0.12)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(0,240,234,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  // Corner handles (skip for text — DOM TextRegionFrame / dashed outline is enough)
  if (tool === "text") return;

  const cornerColor = tool === "crop" ? "#fbbf24" : tool === "delogo" ? "#ef4444" : "#ffffff";
  const ms = Math.min(12, w / 3, h / 3);
  ctx.strokeStyle = cornerColor;
  ctx.lineWidth = 2.5;
  [
    [x, y, ms, 0, 0, ms],
    [x + w, y, -ms, 0, 0, ms],
    [x, y + h, ms, 0, 0, -ms],
    [x + w, y + h, -ms, 0, 0, -ms],
  ].forEach(([cx, cy, dx1, dy1, dx2, dy2]) => {
    ctx.beginPath();
    ctx.moveTo(cx + dx1, cy + dy1);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx2, cy + dy2);
    ctx.stroke();
  });

  // Resize dots
  const hs = 7;
  ctx.fillStyle = cornerColor;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  [
    [x, y],
    [x + w / 2, y],
    [x + w, y],
    [x, y + h / 2],
    [x + w, y + h / 2],
    [x, y + h],
    [x + w / 2, y + h],
    [x + w, y + h],
  ].forEach(([hx, hy]) => {
    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
  });
}

export function fmtTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/* ── Excel utilities ────────────────────────────────────────────────── */

export function stripExt(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** Format Excel-ish IDs without scientific notation (large numeric cells). */
export function formatMatchIdRaw(raw) {
  const fullwide = (n) =>
    n.toLocaleString("fullwide", { useGrouping: false, maximumFractionDigits: 20 });
  if (typeof raw === "number" && Number.isFinite(raw)) return fullwide(raw);
  const s = String(raw).trim();
  // Some readers stringify large IDs as "1.23e+21" — expand when parseable.
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return fullwide(n);
  }
  return s;
}

/** Canonical ID for matching queue videos to Excel rows (trim, lowercase, no extension). */
export function normalizeMatchId(name) {
  if (name === undefined || name === null) return "";
  return stripExt(formatMatchIdRaw(name)).toLowerCase();
}

export function rowGet(row, ...keys) {
  const lower = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase().trim()] = row[k];
  const normalizedKeys = keys.map((k) => String(k).toLowerCase().trim());
  for (const k of keys) {
    const v = lower[k.toLowerCase().trim()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  // Broader fallback: try common ID column names
  const idAliases = [
    "id",
    "identificador",
    "filename",
    "archivo",
    "nombre",
    "video",
    "name",
    "codigo",
    "code",
  ];
  if (!normalizedKeys.some((k) => idAliases.includes(k))) return undefined;
  for (const alias of idAliases) {
    if (normalizedKeys.includes(alias)) continue;
    const v = lower[alias];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
