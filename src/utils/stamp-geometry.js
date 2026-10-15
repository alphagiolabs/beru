import { frameRectAfterCrops } from "./crop-output.js";
import { normalizeTransform, outputLayout } from "./output-geometry.js";
import { scaleTextStyleToRegion } from "./text-style.js";
import { getLockedDimensions } from "./video-dimensions.js";
import { regionToScreen } from "./video-utils.js";

export function itemOutputGeometry(item, transform = item?.transform) {
  const { width, height } = getLockedDimensions(item);
  if (!(width > 0 && height > 0)) return null;
  const crop = frameRectAfterCrops(item.operations ?? [], { w: width, h: height });
  const t = normalizeTransform(transform);
  return {
    source: { width, height },
    crop,
    transform: t,
    output: outputLayout({ width: crop.width, height: crop.height }, t),
  };
}

export function fitStampsToOutput(operations, from, to) {
  if (!from || !to || (from.width === to.width && from.height === to.height)) return operations;
  let changed = false;
  const next = operations.map((op) => {
    if (op?.mode !== "datetime" || !op.region) return op;
    changed = true;
    const boxW = op.region.w * from.width;
    const boxH = op.region.h * from.height;
    const k = Math.min(to.height / from.height, to.width / boxW);
    const w = Math.min(1, (boxW * k) / to.width);
    const h = Math.min(1, (boxH * k) / to.height);
    return {
      ...op,
      ...scaleTextStyleToRegion(op, { w: 1, h: 1 }, { w: k, h: k }),
      region: {
        x: Math.min(op.region.x, 1 - w),
        y: Math.min(op.region.y, 1 - h),
        w,
        h,
      },
    };
  });
  return changed ? next : operations;
}

function outputPointToSource(u, v, geo) {
  const { output, transform: t, crop, source } = geo;
  let p = (u * output.width - output.content.x) / output.content.w;
  let q = (v * output.height - output.content.y) / output.content.h;
  if (t.flipH) p = 1 - p;
  if (t.flipV) q = 1 - q;
  let a = p;
  let b = q;
  if (t.rotation === 90) [a, b] = [q, 1 - p];
  else if (t.rotation === 180) [a, b] = [1 - p, 1 - q];
  else if (t.rotation === 270) [a, b] = [1 - q, p];
  return {
    x: (crop.x + a * crop.width) / source.width,
    y: (crop.y + b * crop.height) / source.height,
  };
}

export function outputRegionOnSource(region, geo) {
  const a = outputPointToSource(region.x, region.y, geo);
  const b = outputPointToSource(region.x + region.w, region.y + region.h, geo);
  const t = geo.transform;
  const scale = `scale(${t.flipH ? -1 : 1}, ${t.flipV ? -1 : 1})`;
  return {
    rect: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    },
    quarterTurns: t.rotation / 90,
    cssTransform: `rotate(${-t.rotation}deg) ${scale}`,
  };
}

function sourceToOutputAffine(geo) {
  const o = outputPointToSource(0, 0, geo);
  const ux = outputPointToSource(1, 0, geo);
  const vy = outputPointToSource(0, 1, geo);
  const ax = ux.x - o.x;
  const ay = ux.y - o.y;
  const bx = vy.x - o.x;
  const by = vy.y - o.y;
  const det = ax * by - ay * bx;
  const a = by / det;
  const b = -ay / det;
  const c = -bx / det;
  const d = ax / det;
  return { a, b, c, d, e: -(a * o.x + c * o.y), f: -(b * o.x + d * o.y) };
}

export function sourceRegionToOutput(rect, geo) {
  const m = sourceToOutputAffine(geo);
  const at = (x, y) => ({ u: m.a * x + m.c * y + m.e, v: m.b * x + m.d * y + m.f });
  const p = at(rect.x, rect.y);
  const q = at(rect.x + rect.w, rect.y + rect.h);
  return {
    x: Math.min(p.u, q.u),
    y: Math.min(p.v, q.v),
    w: Math.abs(q.u - p.u),
    h: Math.abs(q.v - p.v),
  };
}

export function showsOutputFrame(geo) {
  if (!geo) return false;
  const { transform: t, crop, source } = geo;
  return (
    t.rotation !== 0 ||
    t.flipH ||
    t.flipV ||
    geo.output.resized ||
    crop.width !== source.width ||
    crop.height !== source.height
  );
}

export function fitOutputStage(geo, available) {
  const { width, height } = geo.output;
  const scale = Math.min(available.width / width, available.height / height);
  if (!(scale > 0)) return null;
  return { width: width * scale, height: height * scale };
}

export function outputStageLayer(geo, stage) {
  const m = sourceToOutputAffine(geo);
  const { output, crop, source } = geo;
  const cropAcross = geo.transform.rotation % 180 ? crop.height : crop.width;
  const scale = ((stage.width / output.width) * output.content.w) / cropAcross;
  const width = source.width * scale;
  const height = source.height * scale;
  const matrix = [
    (stage.width * m.a) / width,
    (stage.height * m.b) / width,
    (stage.width * m.c) / height,
    (stage.height * m.d) / height,
    stage.width * m.e,
    stage.height * m.f,
  ];
  return { width, height, transform: `matrix(${matrix.join(",")})` };
}

export function stampPlacement(region, geo, videoEl) {
  if (!region) return null;
  if (!geo) {
    const screen = regionToScreen(region, videoEl);
    return screen && { screen, cssTransform: undefined };
  }
  const { rect, quarterTurns, cssTransform } = outputRegionOnSource(region, geo);
  const box = regionToScreen(rect, videoEl);
  if (!box) return null;
  const [w, h] = quarterTurns % 2 ? [box.h, box.w] : [box.w, box.h];
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const t = geo.transform;
  const upright = t.rotation === 0 && !t.flipH && !t.flipV;
  return {
    screen: {
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
      sx: w / Math.max(1e-6, region.w * geo.output.width),
      sy: h / Math.max(1e-6, region.h * geo.output.height),
    },
    cssTransform: upright ? undefined : cssTransform,
  };
}
