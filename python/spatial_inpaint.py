"""Conservative texture continuation from unmasked samples in the same frame."""

import numpy as np


def reconstruct_texture(original, fallback, box, *, guard=2, search=96):
    height, width = original.shape[:2]
    x, y, w, h = box
    if w + guard > search and h + guard > search:
        return fallback
    scale = 257.0 if original.dtype == np.uint16 else 1.0
    image = original.astype(np.float32) / scale
    yy, xx = np.mgrid[
        max(0, y - 6) : min(height, y + h + 6), max(0, x - 6) : min(width, x + w + 6)
    ]
    ring = (
        (xx < x - guard)
        | (xx >= x + w + guard)
        | (yy < y - guard)
        | (yy >= y + h + guard)
    )
    xx, yy = xx[ring], yy[ring]
    stride = max(1, len(xx) // 384)
    xx, yy = xx[::stride], yy[::stride]
    if len(xx) < 32:
        return fallback
    target = image[yy, xx]
    if float(target.std(axis=0).max()) < 2:
        return fallback

    def score_offsets(offsets):
        offsets = np.asarray(offsets, dtype=np.int32)
        dx, dy = offsets.T
        allowed = (
            (x + dx >= 0)
            & (y + dy >= 0)
            & (x + dx + w <= width)
            & (y + dy + h <= height)
            & (
                (dx + w <= -guard)
                | (dx >= w + guard)
                | (dy + h <= -guard)
                | (dy >= h + guard)
            )
        )
        scores = np.full(len(offsets), np.inf)
        indices = np.flatnonzero(allowed)
        for start in range(0, len(indices), 64):
            batch = indices[start : start + 64]
            sx, sy = xx + dx[batch, None], yy + dy[batch, None]
            valid = (sx >= 0) & (sx < width) & (sy >= 0) & (sy < height)
            valid &= (
                (sx < x - guard)
                | (sx >= x + w + guard)
                | (sy < y - guard)
                | (sy >= y + h + guard)
            )
            eligible = valid.sum(axis=1) >= max(32, len(xx) * 0.8)
            if not eligible.any():
                continue
            batch, valid, sx, sy = (
                batch[eligible],
                valid[eligible],
                sx[eligible],
                sy[eligible],
            )
            error = image[np.clip(sy, 0, height - 1), np.clip(sx, 0, width - 1)]
            error -= target
            np.abs(error, out=error)
            complete = valid.all(axis=1)
            if complete.any():
                contiguous = error[complete].reshape(int(complete.sum()), -1)
                scores[batch[complete]] = contiguous.mean(axis=1)
            for index, residual, keep in zip(
                batch[~complete], error[~complete], valid[~complete]
            ):
                scores[index] = float(residual[keep].mean())
        return [
            (float(value), int(dx), int(dy)) for value, (dx, dy) in zip(scores, offsets)
        ]

    coarse = score_offsets(
        [
            (dx, dy)
            for dy in range(-search, search + 1, 4)
            for dx in range(-search, search + 1, 4)
        ]
    )
    coarse.sort(
        key=lambda entry: (
            entry[0] + 0.005 * (abs(entry[1]) + abs(entry[2])),
            abs(entry[1]) + abs(entry[2]),
        )
    )
    candidates = set()
    for _, cx, cy in coarse[:6]:
        candidates.update(
            (dx, dy)
            for dy in range(max(-search, cy - 3), min(search, cy + 3) + 1)
            for dx in range(max(-search, cx - 3), min(search, cx + 3) + 1)
        )
    scored = score_offsets(sorted(candidates))
    residual, dx, dy = min(
        scored,
        key=lambda entry: (
            entry[0] + 0.005 * (abs(entry[1]) + abs(entry[2])),
            abs(entry[1]) + abs(entry[2]),
        ),
    )
    if residual > 2:
        return fallback
    result = original.copy()
    result[y : y + h, x : x + w] = original[y + dy : y + dy + h, x + dx : x + dx + w]
    return result
