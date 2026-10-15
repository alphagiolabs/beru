"""Exemplar inpainting: feathered tiles copied from unmasked samples in the same frame."""

import numpy as np

_DC_WEIGHT = 0.5
_DISTANCE_COST = 0.0005
# Ring score (per-sample squared error) of a copy that continues the texture exactly.
EXACT_SCORE = 8


def _fast_length(n):
    """Smallest 5-smooth size >= n; FFTs of prime sizes are several times slower."""
    while True:
        m = n
        for p in (2, 3, 5):
            while m % p == 0:
                m //= p
        if m == 1:
            return n
        n += 1


def _window_scores(image, rect, mask, fill, window):
    """Ring mismatch of every source position for ``rect`` inside ``window``.

    The masked SSD is evaluated for all positions at once through FFT
    correlation; most of the mean difference is forgiven because the
    lighting plane absorbs it after the copy.
    """
    wx, wy, ww, wh = window
    ex, ey, ew, eh = rect
    fx, fy, fw, fh = fill
    planes = image[wy : wy + wh, wx : wx + ww].astype(np.float64).transpose(2, 0, 1)
    template = image[ey : ey + eh, ex : ex + ew].astype(np.float64).transpose(2, 0, 1) * mask
    shape = (_fast_length(wh), _fast_length(ww))
    spectrum = np.fft.rfft2(planes, shape)
    mask_spectrum = np.conj(np.fft.rfft2(mask, shape))
    # Channel sums are linear, so they collapse before the inverse transforms.
    ssd_spectrum = np.fft.rfft2((planes * planes).sum(axis=0), shape) * mask_spectrum - 2 * (
        spectrum * np.conj(np.fft.rfft2(template, shape))
    ).sum(axis=0)
    valid = (Ellipsis, slice(0, wh - eh + 1), slice(0, ww - ew + 1))
    ssd = np.fft.irfft2(ssd_spectrum, shape)[valid] + (template * template).sum()
    dc = np.fft.irfft2(spectrum * mask_spectrum, shape)[valid]
    dc -= template.sum(axis=(1, 2))[:, None, None]
    n = mask.sum()
    score = (ssd - _DC_WEIGHT * (dc * dc).sum(axis=0) / n) / (n * len(planes))
    py, px = np.mgrid[wy : wy + wh - eh + 1, wx : wx + ww - ew + 1]
    score[(px < fx + fw) & (px + ew > fx) & (py < fy + fh) & (py + eh > fy)] = np.inf
    score += _DISTANCE_COST * (np.abs(px - ex) + np.abs(py - ey))
    return score


def _offset_scores(image, rect, known, fill, offsets):
    """Ring scores of candidate ``(dx, dy)`` offsets, matching ``_window_scores``."""
    height, width = image.shape[:2]
    ex, ey, ew, eh = rect
    fx, fy, fw, fh = fill
    dx, dy = np.asarray(offsets).T
    sx, sy = ex + dx, ey + dy
    allowed = (sx >= 0) & (sy >= 0) & (sx + ew <= width) & (sy + eh <= height)
    allowed &= (sx >= fx + fw) | (sx + ew <= fx) | (sy >= fy + fh) | (sy + eh <= fy)
    scores = np.full(len(dx), np.inf)
    if not allowed.any():
        return scores
    ky, kx = np.nonzero(known)
    ky, kx = ky + ey, kx + ex
    diff = (
        image[ky + dy[allowed, None], kx + dx[allowed, None]] - image[ky, kx]
    ).astype(np.float64)
    dc = diff.sum(axis=1)
    ssd = (diff * diff).sum(axis=(1, 2))
    scores[allowed] = (ssd - _DC_WEIGHT * (dc * dc).sum(axis=1) / len(ky)) / diff[0].size
    return scores + _DISTANCE_COST * (np.abs(dx) + np.abs(dy))


def _search(image, half, known, rect, fill, window):
    """Best ``(dx, dy, score)`` for ``rect``: an FFT search over even offsets on
    every other pixel, refined to the pixel at full resolution.

    Decimating (not averaging) keeps fine texture, so the coarse score samples
    the full-resolution one instead of comparing blurred copies.
    """
    ex, ey, ew, eh = rect
    fx, fy, fw, fh = fill
    wx, wy, ww, wh = window
    hx, hy, hw, hh = ex // 2, ey // 2, ew // 2, eh // 2
    coarse = _window_scores(
        half,
        (hx, hy, hw, hh),
        known[2 * hy : 2 * hy + 2 * hh : 2, 2 * hx : 2 * hx + 2 * hw : 2].astype(np.float64),
        # One extra sample of clearance keeps the full-size rect off the fill.
        (fx // 2 - 1, fy // 2 - 1, (fx + fw + 1) // 2 - fx // 2 + 2, (fy + fh + 1) // 2 - fy // 2 + 2),
        (wx // 2, wy // 2, ww // 2, wh // 2),
    )
    leads = np.argsort(coarse, axis=None)[:3]
    leads = leads[np.isfinite(coarse.flat[leads])]
    ring = known[ey : ey + eh, ex : ex + ew]
    if len(leads):
        py, px = np.divmod(leads, coarse.shape[1])
        centers = np.stack([2 * (wx // 2 + px - hx), 2 * (wy // 2 + py - hy)], 1)
        steps = np.array([(dx, dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
        offsets = (centers[:, None] + steps).reshape(-1, 2)
        scores = _offset_scores(image, rect, ring, fill, offsets)
        best = int(np.argmin(scores))
        if np.isfinite(scores[best]):
            return int(offsets[best, 0]), int(offsets[best, 1]), float(scores[best])
    scores = _window_scores(image, rect, ring.astype(np.float64), fill, window)
    index = int(np.argmin(scores))
    if not np.isfinite(scores.flat[index]):
        return None
    py, px = divmod(index, scores.shape[1])
    return wx + px - ex, wy + py - ey, float(scores.flat[index])


def _lighting(target, source, known):
    """Least-squares plane of the ring difference; a slope needs both sides known."""
    eh, ew = known.shape
    iy, ix = np.mgrid[0:eh, 0:ew]
    grids = [np.ones((eh, ew))]
    if known[:, 0].any() and known[:, -1].any():
        grids.append((ix - ew / 2) / ew)
    if known[0].any() and known[-1].any():
        grids.append((iy - eh / 2) / eh)
    basis = np.stack([grid[known] for grid in grids], 1)
    coef = np.linalg.lstsq(basis, (target - source)[known], rcond=None)[0]
    return sum(grid[..., None] * c for grid, c in zip(grids, coef))


def reconstruct_texture(original, box, *, guard=2, band=6, tile=48, reach=64):
    """Return ``(repaired, worst ring score)`` or ``(None, None)`` when no source fits.

    ``box`` plus ``guard`` is filled tile by tile from the border inward; each
    tile copies the block whose surrounding ring best matches, corrects its
    lighting and cross-fades over ``band`` known pixels. Frames are independent,
    so an exact preview or a bounded export reproduces the full export.
    """
    height, width = original.shape[:2]
    x, y, w, h = box
    scale = 257.0 if original.dtype == np.uint16 else 1.0
    image = original.astype(np.float32) / scale
    fx, fy = max(band, x - guard), max(band, y - guard)
    fw = min(width - band, x + w + guard) - fx
    fh = min(height - band, y + h + guard) - fy
    if fw <= 0 or fh <= 0:
        return None, None
    fill = (fx, fy, fw, fh)
    half = image[::2, ::2]
    known = np.ones((height, width), bool)
    known[fy : fy + fh, fx : fx + fw] = False
    # Large fills use larger tiles so the search count stays bounded.
    tile = max(tile, int(np.ceil(np.sqrt(fw * fh / 8))))
    xs = np.linspace(fx, fx + fw, -(-fw // tile) + 1).round().astype(int)
    ys = np.linspace(fy, fy + fh, -(-fh // tile) + 1).round().astype(int)
    tiles = [
        (left, top, right - left, bottom - top)
        for top, bottom in zip(ys, ys[1:])
        for left, right in zip(xs, xs[1:])
    ]
    depth = [
        min(tx - fx, ty - fy, fx + fw - tx - tw, fy + fh - ty - th)
        for tx, ty, tw, th in tiles
    ]
    worst = 0.0
    for k in sorted(range(len(tiles)), key=depth.__getitem__):
        tx, ty, tw, th = tiles[k]
        rect = ex, ey, ew, eh = tx - band, ty - band, tw + 2 * band, th + 2 * band
        ring = known[ey : ey + eh, ex : ex + ew].copy()
        r = reach + depth[k]
        wx, wy = max(0, ex - r), max(0, ey - r)
        window = (wx, wy, min(width, ex + ew + r) - wx, min(height, ey + eh + r) - wy)
        found = _search(image, half, known, rect, fill, window)
        if found is None:
            return None, None
        dx, dy, score = found
        worst = max(worst, score)
        target = image[ey : ey + eh, ex : ex + ew]
        source = image[ey + dy : ey + dy + eh, ex + dx : ex + dx + ew]
        iy, ix = np.ogrid[0:eh, 0:ew]
        distance = np.minimum(np.minimum(iy, eh - 1 - iy), np.minimum(ix, ew - 1 - ix))
        alpha = np.where(ring, np.clip((distance + 1) / (band + 1), 0, 1), 1)[..., None]
        target += alpha * (source + _lighting(target, source, ring) - target)
        known[ty : ty + th, tx : tx + tw] = True
    fx, fy, fw, fh = fx - band, fy - band, fw + 2 * band, fh + 2 * band
    repaired = original.copy()
    repaired[fy : fy + fh, fx : fx + fw] = np.clip(
        np.rint(image[fy : fy + fh, fx : fx + fw] * scale), 0, 65535 if scale > 1 else 255
    )
    return repaired, worst
