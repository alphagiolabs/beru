import math

ROTATIONS = (0, 90, 180, 270)
FIT_MODES = ("pad", "stretch", "crop")
OUTPUT_SIZE_MIN = 16
OUTPUT_SIZE_MAX = 8192
ASPECT_FILL_TOLERANCE = 0.01


def _even_pixels(value):
    return max(2, value - 1 if value % 2 else value)


def _even_floor(value):
    return math.floor(value / 2) * 2


def _output_size(value, minimum=1):
    if not isinstance(value, int) or isinstance(value, bool):
        return None
    return value if minimum <= value <= OUTPUT_SIZE_MAX else None


def normalize_transform(job):
    """Transform fields of a job (snake_case); missing or invalid values fall back to identity."""
    if not isinstance(job, dict):
        return {"rotation": 0, "flip_h": False, "flip_v": False, "output_height": None,
                "output_width": None, "fit_mode": "pad"}
    try:
        rotation = float(job.get("rotation") or 0)
    except (TypeError, ValueError):
        rotation = 0
    if rotation not in ROTATIONS:
        rotation = 0
    output_height = _output_size(job.get("output_height"))
    output_width = None if output_height is None else _output_size(job.get("output_width"),
                                                                   OUTPUT_SIZE_MIN)
    if output_width is not None:
        output_height = max(OUTPUT_SIZE_MIN, output_height)
    fit_mode = job.get("fit_mode")
    return {
        "rotation": int(rotation),
        "flip_h": job.get("flip_h") is True,
        "flip_v": job.get("flip_v") is True,
        "output_height": output_height,
        "output_width": output_width,
        "fit_mode": fit_mode if fit_mode in FIT_MODES else "pad",
    }


def is_identity_transform(transform):
    return (transform["rotation"] == 0 and not transform["flip_h"]
            and not transform["flip_v"] and transform["output_height"] is None)


def output_layout(width, height, transform):
    if transform["rotation"] in (90, 270):
        width, height = height, width

    def full(w, h, resized):
        return w, h, resized, {"x": 0, "y": 0, "w": w, "h": h}

    if transform.get("output_width") is not None:
        out_w = _even_pixels(transform["output_width"])
        out_h = _even_pixels(transform["output_height"])
        mismatch = abs(out_w * height - out_h * width) / (out_h * width)
        if transform.get("fit_mode") == "stretch" or mismatch <= ASPECT_FILL_TOLERANCE:
            return full(out_w, out_h, out_w != width or out_h != height)
        pick = max if transform.get("fit_mode") == "crop" else min
        scale = pick(out_w / width, out_h / height)
        w = _even_pixels(round(width * scale))
        h = _even_pixels(round(height * scale))
        return out_w, out_h, True, {"x": _even_floor((out_w - w) / 2),
                                    "y": _even_floor((out_h - h) / 2), "w": w, "h": h}
    target = transform["output_height"]
    if target is None or target >= height:
        return full(width, height, False)
    next_height = _even_pixels(target)
    next_width = _even_pixels(round(width * next_height / height))
    return full(next_width, next_height, True)


def transform_filters(transform, width, height):
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
    out_w, out_h, resized, content = output_layout(width, height, transform)
    if resized:
        chain.append(f"scale={content['w']}:{content['h']}:flags=lanczos")
        if content["w"] < out_w or content["h"] < out_h:
            chain.append(f"pad={out_w}:{out_h}:{content['x']}:{content['y']}:color=black")
        elif content["w"] > out_w or content["h"] > out_h:
            chain.append(f"crop={out_w}:{out_h}:{-content['x']}:{-content['y']}")
        if transform.get("output_width") is not None:
            chain.append("setsar=1")
    return chain, (out_w, out_h)
