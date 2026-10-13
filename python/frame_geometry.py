"""Per-video geometry after the crops: quarter-turn rotation, flips and output height.

Mirrors src/utils/output-geometry.js; tests/fixtures/output-geometry-cases.json keeps both in step.
"""

ROTATIONS = (0, 90, 180, 270)


def _even_pixels(value):
    return max(2, value - 1 if value % 2 else value)


def normalize_transform(job):
    """Transform fields of a job (snake_case); missing or invalid values fall back to identity."""
    if not isinstance(job, dict):
        return {"rotation": 0, "flip_h": False, "flip_v": False, "output_height": None}
    try:
        rotation = float(job.get("rotation") or 0)
    except (TypeError, ValueError):
        rotation = 0
    if rotation not in ROTATIONS:
        rotation = 0
    output_height = job.get("output_height")
    if not isinstance(output_height, int) or isinstance(output_height, bool) or output_height <= 0:
        output_height = None
    return {
        "rotation": int(rotation),
        "flip_h": job.get("flip_h") is True,
        "flip_v": job.get("flip_v") is True,
        "output_height": output_height,
    }


def is_identity_transform(transform):
    return (transform["rotation"] == 0 and not transform["flip_h"]
            and not transform["flip_v"] and transform["output_height"] is None)


def output_dimensions(width, height, transform):
    """(width, height, resized) of the output for a frame of width x height."""
    if transform["rotation"] in (90, 270):
        width, height = height, width
    target = transform["output_height"]
    if target is None or target >= height:
        return width, height, False
    next_height = _even_pixels(target)
    next_width = _even_pixels(round(width * next_height / height))
    return next_width, next_height, True


def transform_filters(transform, width, height):
    """ffmpeg filters applying the transform to a frame of width x height, in order:
    rotation, flips (relative to the rotated frame), then the output scale."""
    chain = []
    if transform["rotation"] == 90:
        chain.append("transpose=1")
    elif transform["rotation"] == 180:
        chain += ["hflip", "vflip"]
    elif transform["rotation"] == 270:
        chain.append("transpose=2")
    if transform["flip_h"]:
        chain.append("hflip")
    if transform["flip_v"]:
        chain.append("vflip")
    out_w, out_h, resized = output_dimensions(width, height, transform)
    if resized:
        chain.append(f"scale={out_w}:{out_h}:flags=lanczos")
    return chain, (out_w, out_h)
