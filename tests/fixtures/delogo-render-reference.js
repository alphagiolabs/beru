export function referenceMedianChannel(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function referenceQuickselectMedian(a) {
  const n = a.length;
  if (n === 0) return 0;
  if (n === 1) return a[0];
  const k = n >> 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i++] = a[j];
        a[j--] = t;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  if (n % 2) return a[k];
  let maxLo = a[0];
  for (let i = 1; i < k; i++) if (a[i] > maxLo) maxLo = a[i];
  return Math.round((maxLo + a[k]) / 2);
}

export function referenceTemporal(frames, pixelCount) {
  const out = new Uint8ClampedArray(pixelCount * 4);
  const n = frames.length;
  const rs = new Uint8ClampedArray(n);
  const gs = new Uint8ClampedArray(n);
  const bs = new Uint8ClampedArray(n);
  const work = new Uint8ClampedArray(n);

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    for (let f = 0; f < n; f++) {
      const fd = frames[f].data;
      rs[f] = fd[o];
      gs[f] = fd[o + 1];
      bs[f] = fd[o + 2];
    }
    work.set(rs);
    out[o] = referenceQuickselectMedian(work);
    work.set(gs);
    out[o + 1] = referenceQuickselectMedian(work);
    work.set(bs);
    out[o + 2] = referenceQuickselectMedian(work);
    out[o + 3] = 255;
  }
  return out;
}

export function referenceMosaic(data, sw, sh, blockSize) {
  const cols = Math.max(1, Math.ceil(sw / blockSize));
  const rows = Math.max(1, Math.ceil(sh / blockSize));
  const out = new Uint8ClampedArray(cols * rows * 4);

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
  return out;
}

export function referenceInpaint(sData, sw, sh) {
  const dData = new Uint8ClampedArray(sw * sh * 4);
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
  return dData;
}
