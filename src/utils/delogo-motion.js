export function motionDescriptor(frame, width, height) {
  const gray = new Float32Array(width * height);
  const low = new Float32Array(gray.length);
  const horizontal = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++)
    gray[i] = frame[i * 4] * 0.299 + frame[i * 4 + 1] * 0.587 + frame[i * 4 + 2] * 0.114;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let d = -2; d <= 2; d++)
        sum += gray[y * width + Math.max(0, Math.min(width - 1, x + d))];
      horizontal[y * width + x] = sum / 5;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let d = -2; d <= 2; d++)
        sum += horizontal[Math.max(0, Math.min(height - 1, y + d)) * width + x];
      low[y * width + x] = sum / 5;
    }
  return { gray, low };
}

export function estimateMotion(current, donor, width, height, box, search = 24) {
  const points = [];
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 900)));
  const outside = (x, y, margin = 2) =>
    x < box.x - margin ||
    x >= box.x + box.w + margin ||
    y < box.y - margin ||
    y >= box.y + box.h + margin;
  for (let y = 2; y < height - 2; y += step)
    for (let x = 2; x < width - 2; x += step) if (outside(x, y)) points.push([x, y]);
  if (points.length < 32) return null;
  const score = (dx, dy, coarse) => {
    const a = coarse ? current.low : current.gray;
    const b = coarse ? donor.low : donor.gray;
    let total = 0,
      count = 0;
    for (const [x, y] of points) {
      const sx = x + dx,
        sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || !outside(sx, sy)) continue;
      total += Math.min(60, Math.abs(a[y * width + x] - b[sy * width + sx]));
      count++;
    }
    return count >= Math.max(32, points.length / 2) ? total / count : Infinity;
  };
  const better = (candidate, best) =>
    candidate.error < best.error ||
    (candidate.error === best.error &&
      Math.abs(candidate.dx) + Math.abs(candidate.dy) < Math.abs(best.dx) + Math.abs(best.dy));
  const stationary = score(0, 0, false);
  if (stationary <= 0.25) return { dx: 0, dy: 0, error: stationary };
  let best = { dx: 0, dy: 0, error: Infinity };
  for (let dy = -search; dy <= search; dy += 4)
    for (let dx = -search; dx <= search; dx += 4) {
      const candidate = { dx, dy, error: score(dx, dy, true) };
      if (better(candidate, best)) best = candidate;
    }
  const coarse = best;
  best = { dx: 0, dy: 0, error: Infinity };
  for (let dy = Math.max(-search, coarse.dy - 3); dy <= Math.min(search, coarse.dy + 3); dy++)
    for (let dx = Math.max(-search, coarse.dx - 3); dx <= Math.min(search, coarse.dx + 3); dx++) {
      const candidate = { dx, dy, error: score(dx, dy, false) };
      if (better(candidate, best)) best = candidate;
    }
  return best.error <= 8 ? best : null;
}

export function compensateTemporal(
  descriptor,
  history,
  width,
  height,
  box,
  out,
  median,
  guard = 2,
) {
  const donors = history.flatMap((entry) => {
    const motion = estimateMotion(descriptor, entry.descriptor, width, height, box);
    return motion && (motion.dx || motion.dy) ? [{ frame: entry.frame, ...motion }] : [];
  });
  const values = new Uint8ClampedArray(donors.length);
  const work = new Uint8ClampedArray(donors.length);
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++)
      for (let c = 0; c < 3; c++) {
        let count = 0;
        let trusted = false;
        for (const donor of donors) {
          const sx = x + donor.dx,
            sy = y + donor.dy;
          if (
            sx < 0 ||
            sy < 0 ||
            sx >= width ||
            sy >= height ||
            (sx >= box.x - guard &&
              sx < box.x + box.w + guard &&
              sy >= box.y - guard &&
              sy < box.y + box.h + guard)
          )
            continue;
          values[count++] = donor.frame[(sy * width + sx) * 4 + c];
          trusted ||= donor.error <= 1;
        }
        if (count >= 2 || trusted) out[(y * width + x) * 4 + c] = median(work, values, count);
      }
}
