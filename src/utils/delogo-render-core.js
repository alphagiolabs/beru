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

export function temporalMedianInto(frames, out, pixelCount) {
  const n = frames.length;
  if (n === 0) {
    for (let i = 0; i < pixelCount; i++) {
      const o = i * 4;
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 255;
    }
    return;
  }
  const rs = new Uint8ClampedArray(n);
  const gs = new Uint8ClampedArray(n);
  const bs = new Uint8ClampedArray(n);
  const work = new Uint8ClampedArray(n);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    for (let f = 0; f < n; f++) {
      const fd = frames[f];
      rs[f] = fd[o];
      gs[f] = fd[o + 1];
      bs[f] = fd[o + 2];
    }
    out[o] = insertionMedian(work, rs, n);
    out[o + 1] = insertionMedian(work, gs, n);
    out[o + 2] = insertionMedian(work, bs, n);
    out[o + 3] = 255;
  }
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

export function inpaintInto(sData, dData, sw, sh) {
  const lastRow = (sh - 1) * sw;
  const lastCol = sw - 1;

  for (let y = 0; y < sh; y++) {
    const rowOff = y * sw;
    for (let x = 0; x < sw; x++) {
      const ti = x * 4;
      const bi = (lastRow + x) * 4;
      const li = rowOff * 4;
      const ri = (rowOff + lastCol) * 4;
      const wt = 1 / (y + 1);
      const wb = 1 / (sh - y);
      const wl = 1 / (x + 1);
      const wr = 1 / (sw - x);
      const total = wt + wb + wl + wr;
      const di = (rowOff + x) * 4;
      dData[di] = (sData[ti] * wt + sData[bi] * wb + sData[li] * wl + sData[ri] * wr) / total;
      dData[di + 1] =
        (sData[ti + 1] * wt + sData[bi + 1] * wb + sData[li + 1] * wl + sData[ri + 1] * wr) / total;
      dData[di + 2] =
        (sData[ti + 2] * wt + sData[bi + 2] * wb + sData[li + 2] * wl + sData[ri + 2] * wr) / total;
      dData[di + 3] = 255;
    }
  }
}

function temporalMaxFrames(radius) {
  return Math.max(3, Math.min(15, radius * 2 + 1));
}

export function createDelogoRenderSession() {
  let history = [];
  let frameW = 0;
  let frameH = 0;

  return {
    reset() {
      history = [];
      frameW = 0;
      frameH = 0;
    },
    compute(method, params, frame, width, height) {
      if (method === "temporal") {
        if (history.length && (frameW !== width || frameH !== height)) {
          history = [];
        }
        history.push(frame);
        frameW = width;
        frameH = height;
        const maxFrames = temporalMaxFrames(params?.radius);
        if (history.length > maxFrames) {
          history.shift();
        }
        const out = new Uint8ClampedArray(width * height * 4);
        temporalMedianInto(history, out, width * height);
        return { data: out, width, height };
      }
      if (method === "inpaint") {
        const out = new Uint8ClampedArray(width * height * 4);
        inpaintInto(frame, out, width, height);
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
