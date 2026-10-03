import { compensateTemporal, estimateMotion, motionDescriptor } from "./delogo-motion.js";
import { continueTexture } from "./delogo-inpaint.js";

const TEMPORAL_MAX_SAMPLE_W = 1280;
const TEMPORAL_MAX_SAMPLE_H = 720;

export function temporalSampleSize(sw, sh, boundW, boundH) {
  const maxW = Math.min(TEMPORAL_MAX_SAMPLE_W, boundW ?? TEMPORAL_MAX_SAMPLE_W);
  const maxH = Math.min(TEMPORAL_MAX_SAMPLE_H, boundH ?? TEMPORAL_MAX_SAMPLE_H);
  const scale = Math.min(1, maxW / sw, maxH / sh);
  return {
    sampleW: Math.max(1, Math.round(sw * scale)),
    sampleH: Math.max(1, Math.round(sh * scale)),
  };
}

function insertionMedian(work, values, n) {
  work[0] = values[0];
  for (let i = 1; i < n; i++) {
    const v = values[i];
    let j = i - 1;
    while (j >= 0 && work[j] > v) {
      work[j + 1] = work[j];
      j--;
    }
    work[j + 1] = v;
  }
  const k = n >> 1;
  if (n % 2) return work[k];
  return Math.round((work[k - 1] + work[k]) / 2);
}

export function mosaicOutputSize(sw, sh, blockSize) {
  return {
    cols: Math.max(1, Math.ceil(sw / blockSize)),
    rows: Math.max(1, Math.ceil(sh / blockSize)),
  };
}

export function mosaicInto(data, sw, sh, blockSize, out) {
  const { cols, rows } = mosaicOutputSize(sw, sh, blockSize);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * blockSize;
      const y0 = by * blockSize;
      const x1 = Math.min(x0 + blockSize, sw);
      const y1 = Math.min(y0 + blockSize, sh);
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * sw + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
      const i = (by * cols + bx) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = 255;
    }
  }
}

export function inpaintInto(sData, dData, sw, sh, box) {
  dData.set(sData);
  if (!box || box.w < 1 || box.h < 1) return;
  const left = box.x - 1;
  const right = box.x + box.w;
  const top = box.y - 1;
  const bottom = box.y + box.h;
  if (left < 0 || top < 0 || right >= sw || bottom >= sh) return;
  for (let y = box.y; y < bottom; y++) {
    for (let x = box.x; x < right; x++) {
      const wl = 1 / (x - left);
      const wr = 1 / (right - x);
      const wt = 1 / (y - top);
      const wb = 1 / (bottom - y);
      const total = 3 * (wl + wr + wt + wb);
      const index = (y * sw + x) * 4;
      const li = (y * sw + left) * 4;
      const ri = (y * sw + right) * 4;
      const ti = (top * sw + x) * 4;
      const bi = (bottom * sw + x) * 4;
      for (let c = 0; c < 3; c++) {
        dData[index + c] = Math.round(
          ((sData[li - sw * 4 + c] + sData[li + c] + sData[li + sw * 4 + c]) * wl +
            (sData[ri - sw * 4 + c] + sData[ri + c] + sData[ri + sw * 4 + c]) * wr +
            (sData[ti - 4 + c] + sData[ti + c] + sData[ti + 4 + c]) * wt +
            (sData[bi - 4 + c] + sData[bi + c] + sData[bi + 4 + c]) * wb) /
            total,
        );
      }
      dData[index + 3] = 255;
    }
  }
}

function boxBlurRGBA(data, width, height, radius, passes) {
  const r = Math.max(
    0,
    Math.min(Math.floor(radius), Math.floor((Math.min(width, height) - 1) / 2)),
  );
  if (!r) return data;
  const horizontal = new Uint8ClampedArray(data.length);
  const output = new Uint8ClampedArray(data.length);
  const divisor = 2 * r + 1;
  const reflect = (index, size) =>
    index < 0 ? -index - 1 : index >= size ? 2 * size - index - 1 : index;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let x = -r; x <= r; x++) sum += data[(y * width + reflect(x, width)) * 4 + c];
        for (let x = 0; x < width; x++) {
          horizontal[(y * width + x) * 4 + c] = Math.round(sum / divisor);
          sum +=
            data[(y * width + reflect(x + r + 1, width)) * 4 + c] -
            data[(y * width + reflect(x - r, width)) * 4 + c];
        }
      }
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let y = -r; y <= r; y++) sum += horizontal[(reflect(y, height) * width + x) * 4 + c];
        for (let y = 0; y < height; y++) {
          output[(y * width + x) * 4 + c] = Math.round(sum / divisor);
          sum +=
            horizontal[(reflect(y + r + 1, height) * width + x) * 4 + c] -
            horizontal[(reflect(y - r, height) * width + x) * 4 + c];
        }
      }
    data = output;
  }
  for (let i = 3; i < output.length; i += 4) output[i] = 255;
  return output;
}

function applyLogoMask(data, width, height, box, feather = 0) {
  if (!box) return;
  const right = box.x + box.w - 1;
  const bottom = box.y + box.h - 1;
  const leftF = Math.min(feather, box.x);
  const topF = Math.min(feather, box.y);
  const rightF = Math.min(feather, width - box.x - box.w);
  const bottomF = Math.min(feather, height - box.y - box.h);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const opacity = Math.max(
        0,
        Math.min(
          1,
          leftF ? (x - box.x + leftF) / leftF : Number(x >= box.x),
          topF ? (y - box.y + topF) / topF : Number(y >= box.y),
          rightF ? (right + rightF - x) / rightF : Number(x <= right),
          bottomF ? (bottom + bottomF - y) / bottomF : Number(y <= bottom),
        ),
      );
      data[(y * width + x) * 4 + 3] = Math.floor(255 * opacity * opacity * (3 - 2 * opacity));
    }
}

function reconstructSpatialLogo(frame, width, height, params) {
  const box = params.box;
  const guard = params.referenceGuard ?? 0;
  const left = Math.max(1, box.x - guard),
    top = Math.max(1, box.y - guard);
  const right = Math.min(width - 1, box.x + box.w + guard);
  const bottom = Math.min(height - 1, box.y + box.h + guard);
  let data = new Uint8ClampedArray(frame.length);
  inpaintInto(frame, data, width, height, { x: left, y: top, w: right - left, h: bottom - top });
  if (params.feather > 0) data = boxBlurRGBA(data, width, height, params.smoothRadius ?? 2, 1);
  return data;
}

export function spatialLogoFallback(frame, width, height, params, method = "inpaint") {
  const box = params.box;
  const blurRadius = Math.max(
    0,
    Math.min(Math.floor(params.radius || 0), Math.floor((Math.min(width, height) - 1) / 2)),
  );
  const pad = Math.ceil(
    method === "blur"
      ? (params.feather || 0) + 3 * blurRadius
      : Math.max(params.feather || 0, (params.referenceGuard || 0) + 2) +
          (params.smoothRadius ?? 2),
  );
  const x = Math.max(0, box.x - pad),
    y = Math.max(0, box.y - pad);
  const patchW = Math.min(width, box.x + box.w + pad) - x;
  const patchH = Math.min(height, box.y + box.h + pad) - y;
  const patch = new Uint8ClampedArray(patchW * patchH * 4);
  for (let row = 0; row < patchH; row++) {
    const from = ((y + row) * width + x) * 4;
    patch.set(frame.subarray(from, from + patchW * 4), row * patchW * 4);
  }
  const localBox = { ...box, x: box.x - x, y: box.y - y };
  const data =
    method === "blur"
      ? boxBlurRGBA(patch, patchW, patchH, blurRadius, 3)
      : reconstructSpatialLogo(patch, patchW, patchH, { ...params, box: localBox });
  applyLogoMask(data, patchW, patchH, localBox, params.feather);
  return { data, width: patchW, height: patchH, x, y };
}

export function createDelogoRenderSession() {
  let history = [];
  let frameW = 0;
  let frameH = 0;
  let lastTime = null;
  let lastResult = null;
  let settings = "";

  return {
    reset() {
      history = [];
      frameW = 0;
      frameH = 0;
      lastTime = null;
      lastResult = null;
      settings = "";
    },
    compute(method, params, frame, width, height) {
      if (method === "temporal" || method === "inpaint") {
        const box = params?.box;
        if (!box) return { data: frame.slice(), width, height };
        const key = JSON.stringify([
          method,
          box,
          params.radius,
          params.feather,
          params.guard,
          params.smoothRadius,
          params.search,
          params.referenceGuard,
        ]);
        const timestamp = params.timestamp;
        if (
          history.length &&
          (frameW !== width ||
            frameH !== height ||
            settings !== key ||
            (Number.isFinite(timestamp) &&
              lastTime !== null &&
              (timestamp < lastTime || timestamp - lastTime > 0.5)))
        ) {
          history = [];
          lastResult = null;
        }
        if (lastResult && Number.isFinite(timestamp) && timestamp === lastTime)
          return { ...lastResult, data: lastResult.data.slice() };
        const descriptor = motionDescriptor(frame, width, height);
        if (
          history.length &&
          !estimateMotion(history.at(-1).descriptor, descriptor, width, height, box)
        )
          history = [];
        let out = new Uint8ClampedArray(frame.length);
        const guard = params.guard ?? 2;
        const texture =
          method === "inpaint" &&
          continueTexture(frame, out, width, height, box, guard, params.search ?? 96);
        if (!texture) {
          out = reconstructSpatialLogo(frame, width, height, {
            ...params,
            referenceGuard: params.referenceGuard ?? (method === "inpaint" ? 0 : guard),
          });
          compensateTemporal(descriptor, history, width, height, box, out, insertionMedian, guard);
        }
        applyLogoMask(out, width, height, box, params.feather);
        history.push({ frame, descriptor });
        frameW = width;
        frameH = height;
        const maxFrames = Math.max(
          1,
          Math.min(
            15,
            Number(params.radius) || 3,
            Math.floor((32 * 1024 * 1024) / (width * height * 12)),
          ),
        );
        history = history.slice(-maxFrames);
        settings = key;
        lastTime = Number.isFinite(timestamp) ? timestamp : null;
        lastResult = Number.isFinite(timestamp) ? { data: out.slice(), width, height } : null;
        return { data: out, width, height };
      }
      if (method === "blur") {
        const out = boxBlurRGBA(frame, width, height, params?.radius, 3);
        applyLogoMask(out, width, height, params?.box, params?.feather);
        return { data: out, width, height };
      }
      if (method === "mosaic") {
        const { cols, rows } = mosaicOutputSize(width, height, params?.blockSize);
        const out = new Uint8ClampedArray(cols * rows * 4);
        mosaicInto(frame, width, height, params?.blockSize, out);
        return { data: out, width: cols, height: rows };
      }
      throw new Error(`Unknown delogo render method: ${method}`);
    },
  };
}
