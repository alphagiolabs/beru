export function continueTexture(frame, out, width, height, box, guard = 2, search = 96) {
  if (!box) return false;
  if (box.w + guard > search && box.h + guard > search) return false;
  const points = [];
  const outside = (x, y) =>
    x < box.x - guard ||
    x >= box.x + box.w + guard ||
    y < box.y - guard ||
    y >= box.y + box.h + guard;
  for (let y = Math.max(0, box.y - 6); y < Math.min(height, box.y + box.h + 6); y++)
    for (let x = Math.max(0, box.x - 6); x < Math.min(width, box.x + box.w + 6); x++)
      if (outside(x, y)) points.push([x, y]);
  const stride = Math.max(1, Math.floor(points.length / 384));
  const samples = points.filter((_, index) => index % stride === 0);
  if (samples.length < 32) return false;
  let contrast = 0;
  for (let c = 0; c < 3; c++) {
    let sum = 0,
      squares = 0;
    for (const [x, y] of samples) {
      const v = frame[(y * width + x) * 4 + c];
      sum += v;
      squares += v * v;
    }
    contrast = Math.max(
      contrast,
      Math.sqrt(Math.max(0, squares / samples.length - (sum / samples.length) ** 2)),
    );
  }
  if (contrast < 2) return false;
  const score = (dx, dy, ceiling = Infinity) => {
    if (
      box.x + dx < 0 ||
      box.y + dy < 0 ||
      box.x + dx + box.w > width ||
      box.y + dy + box.h > height
    )
      return Infinity;
    if (!(
      dx + box.w <= -guard ||
      dx >= box.w + guard ||
      dy + box.h <= -guard ||
      dy >= box.h + guard
    ))
      return Infinity;
    const limit = ceiling * samples.length * 3 + 1e-7;
    let error = 0,
      count = 0;
    for (const [x, y] of samples) {
      const sx = x + dx,
        sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || !outside(sx, sy)) continue;
      const a = (y * width + x) * 4,
        b = (sy * width + sx) * 4;
      for (let c = 0; c < 3; c++) error += Math.abs(frame[a + c] - frame[b + c]);
      if (error > limit) return Infinity;
      count++;
    }
    return count >= Math.max(32, samples.length * 0.8) ? error / (count * 3) : Infinity;
  };
  const order = (a, b) =>
    a.error +
      0.005 * (Math.abs(a.dx) + Math.abs(a.dy)) -
      (b.error + 0.005 * (Math.abs(b.dx) + Math.abs(b.dy))) ||
    Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)) ||
    a.dx - b.dx ||
    a.dy - b.dy;
  const coarse = [];
  for (let dy = -search; dy <= search; dy += 4)
    for (let dx = -search; dx <= search; dx += 4) {
      const worst = coarse.at(-1);
      const ceiling =
        coarse.length < 6
          ? Infinity
          : worst.error +
            0.005 * (Math.abs(worst.dx) + Math.abs(worst.dy) - Math.abs(dx) - Math.abs(dy));
      const candidate = { error: score(dx, dy, ceiling), dx, dy };
      if (coarse.length < 6) coarse.push(candidate);
      else if (order(candidate, worst) < 0) coarse[5] = candidate;
      else continue;
      coarse.sort(order);
    }
  const candidates = new Map();
  for (const { dx: cx, dy: cy } of coarse)
    for (let dy = Math.max(-search, cy - 3); dy <= Math.min(search, cy + 3); dy++)
      for (let dx = Math.max(-search, cx - 3); dx <= Math.min(search, cx + 3); dx++)
        candidates.set(`${dx},${dy}`, { error: score(dx, dy), dx, dy });
  const best = [...candidates.values()].sort(order)[0];
  if (!best || best.error > 2) return false;
  out.set(frame);
  for (let y = box.y; y < box.y + box.h; y++) {
    const from = ((y + best.dy) * width + box.x + best.dx) * 4;
    out.set(frame.subarray(from, from + box.w * 4), (y * width + box.x) * 4);
  }
  return true;
}
