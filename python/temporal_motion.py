from collections import deque
import numpy as np


def _gray(frame):
    values = frame.astype(np.float32)
    scale = 257.0 if frame.dtype == np.uint16 else 1.0
    gray = (
        values[..., 0] * 0.299 + values[..., 1] * 0.587 + values[..., 2] * 0.114
    ) / scale
    padded = np.pad(gray, ((2, 2), (2, 2)), mode="edge")
    height, width = gray.shape
    coarse = (
        sum(
            padded[dy : dy + height, dx : dx + width]
            for dy in range(5)
            for dx in range(5)
        )
        / 25
    )
    return gray, coarse


def _motion(current, donor, box, search=24):
    current, low_current = current
    donor, low_donor = donor
    height, width = current.shape
    x, y, w, h = box
    step = max(1, int(np.sqrt(width * height / 900)))
    yy, xx = np.mgrid[2 : height - 2 : step, 2 : width - 2 : step]
    outside = (xx < x - 2) | (xx >= x + w + 2) | (yy < y - 2) | (yy >= y + h + 2)
    xx = xx[outside]
    yy = yy[outside]
    if len(xx) < 32:
        return None

    def best(offsets, coarse=False):
        """Lowest mean clipped difference, ties to the smaller shift (scored at once)."""
        offsets = np.asarray(offsets)
        sx = xx + offsets[:, :1]
        sy = yy + offsets[:, 1:]
        valid = (
            (sx >= 0)
            & (sx < width)
            & (sy >= 0)
            & (sy < height)
            & ((sx < x - 2) | (sx >= x + w + 2) | (sy < y - 2) | (sy >= y + h + 2))
        )
        first, second = (low_current, low_donor) if coarse else (current, donor)
        difference = np.minimum(
            np.abs(
                first[yy, xx]
                - second[np.clip(sy, 0, height - 1), np.clip(sx, 0, width - 1)]
            ),
            60,
        )
        counts = valid.sum(axis=1)
        scores = np.where(valid, difference, 0).sum(axis=1) / np.maximum(counts, 1)
        scores[counts < max(32, len(xx) // 2)] = np.inf
        index = np.lexsort((np.abs(offsets).sum(axis=1), scores))[0]
        return float(scores[index]), int(offsets[index, 0]), int(offsets[index, 1])

    stationary = best([(0, 0)])[0]
    if stationary <= 0.25:
        return 0, 0, stationary
    _, cx, cy = best(
        [
            (dx, dy)
            for dy in range(-search, search + 1, 4)
            for dx in range(-search, search + 1, 4)
        ],
        coarse=True,
    )
    residual, dx, dy = best(
        [
            (dx, dy)
            for dy in range(max(-search, cy - 3), min(search, cy + 3) + 1)
            for dx in range(max(-search, cx - 3), min(search, cx + 3) + 1)
        ]
    )
    if residual > 8:
        return None
    return dx, dy, residual


def _compensate(target, neighbors, box, guard):
    original, filled, gray, scene, protected = target
    if protected:
        return filled
    height, width = gray[0].shape
    x, y, w, h = box
    result = filled.copy()
    motions = []
    for donor in neighbors:
        if donor is target or donor[3] != scene:
            continue
        motion = _motion(gray, donor[2], box)
        if motion is not None and (motion[0] or motion[1]):
            motions.append((donor[0], motion))
    for top in range(y, y + h, 64):
        bottom = min(y + h, top + 64)
        yy, xx = np.mgrid[top:bottom, x : x + w]
        samples = []
        trusted = np.zeros(xx.shape, dtype=bool)
        for frame, (dx, dy, residual) in motions:
            sx = xx + dx
            sy = yy + dy
            valid = (
                (sx >= 0)
                & (sx < width)
                & (sy >= 0)
                & (sy < height)
                & (
                    (sx < x - guard)
                    | (sx >= x + w + guard)
                    | (sy < y - guard)
                    | (sy >= y + h + guard)
                )
            )
            sample = frame[
                np.clip(sy, 0, height - 1), np.clip(sx, 0, width - 1)
            ].astype(np.float32)
            sample[~valid] = np.nan
            samples.append(sample)
            if residual <= 1:
                trusted |= valid
        if not samples:
            continue
        stack = np.stack(samples)
        count = np.sum(~np.isnan(stack[..., 0]), axis=0)
        missing = count == 0
        stack[0, missing] = filled[top:bottom, x : x + w][missing]
        median = np.nanmedian(stack, axis=0)
        valid = (count >= 2) | trusted
        tile = result[top:bottom, x : x + w]
        tile[valid] = np.rint(median[valid]).astype(original.dtype)
    return result


def compensated_frames(frames, box, radius, *, guard=2):
    """Yield centered windows, never importing samples from another detected scene.

    Frames contain (original, spatial fallback) RGB arrays at native precision,
    optionally followed by a flag protecting a verified spatial reconstruction.
    A 64 MiB window budget reduces radius for large patches instead of resizing them.
    """
    window = deque()
    scene = 0
    previous = None
    produced = -1
    last = -1
    effective = None
    for index, frame in enumerate(frames):
        original, filled = frame[:2]
        protected = len(frame) > 2 and frame[2]
        if effective is None:
            frame_bytes = (
                original.nbytes * 2 + original.shape[0] * original.shape[1] * 8
            )
            effective = max(
                1,
                min(
                    int(radius), 15, (64 * 1024 * 1024 // max(1, frame_bytes) - 1) // 2
                ),
            )
        if protected:
            # A verified spatial frame neither borrows nor lends, so it skips motion work.
            gray = None
            scene += 1
        else:
            gray = _gray(original)
            if previous is None or _motion(previous, gray, box) is None:
                scene += 1
        previous = gray
        window.append((index, (original, filled, gray, scene, protected)))
        last = index
        if index >= effective:
            target_index = index - effective
            target = next(frame for number, frame in window if number == target_index)
            yield _compensate(target, [frame for _, frame in window], box, guard)
            produced = target_index
            while window and window[0][0] <= target_index - effective:
                window.popleft()
    if effective is None:
        return
    for target_index in range(produced + 1, last + 1):
        target = next(frame for number, frame in window if number == target_index)
        neighbors = [
            frame for number, frame in window if abs(number - target_index) <= effective
        ]
        yield _compensate(target, neighbors, box, guard)
        while window and window[0][0] <= target_index - effective:
            window.popleft()
