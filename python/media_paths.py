"""Validate processor media paths against approved roots and extensions."""

import os
import re

from color_validation import _validate_drawtext_color
from op_shared import _normalize_operation

VIDEO_INPUT_EXTENSIONS = frozenset(
    {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg"}
)
VIDEO_OUTPUT_EXTENSIONS = frozenset({".mp4", ".mov", ".avi", ".mkv", ".webm"})
IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"})
FONT_EXTENSIONS = frozenset({".ttf", ".otf", ".ttc"})


def validate_media_path(path, allowed_root, allowed_extensions):
    """Return a canonical media path constrained to an approved root and extension."""
    if not isinstance(path, (str, os.PathLike)):
        raise ValueError("Media path must be a string")

    raw_path = os.fspath(path)
    if not raw_path or "\x00" in raw_path or any(ord(char) < 32 or ord(char) == 127 for char in raw_path):
        raise ValueError("Media path contains forbidden characters")
    if any(part == ".." for part in re.split(r"[\\/]+", raw_path)):
        raise ValueError("Media path traversal is not allowed")

    extensions = {
        extension.lower() if str(extension).startswith(".") else f".{str(extension).lower()}"
        for extension in (allowed_extensions or ())
    }
    extension = os.path.splitext(raw_path)[1].lower()
    if not extensions or extension not in extensions:
        raise ValueError(f"Media extension is not allowed: {extension or '(none)'}")

    roots = allowed_root if isinstance(allowed_root, (list, tuple, set, frozenset)) else [allowed_root]
    canonical_path = os.path.realpath(os.path.abspath(raw_path))
    for root in roots:
        if not isinstance(root, (str, os.PathLike)) or not os.fspath(root):
            continue
        canonical_root = os.path.realpath(os.path.abspath(os.fspath(root)))
        try:
            if os.path.commonpath(
                [os.path.normcase(canonical_path), os.path.normcase(canonical_root)]
            ) == os.path.normcase(canonical_root):
                return canonical_path
        except ValueError:
            continue

    raise ValueError("Media path is outside the allowed root")


def _path_parent(path):
    return os.path.dirname(os.path.abspath(os.fspath(path)))


def _validated_job_media(job, *, require_output):
    """Validate and canonicalize every renderer-controlled media path in a job."""
    validated = dict(job)
    input_path = job.get("input_path")
    input_root = job.get("input_root") or (_path_parent(input_path) if input_path else None)
    validated["input_path"] = validate_media_path(
        input_path, input_root, VIDEO_INPUT_EXTENSIONS
    )

    if require_output:
        output_path = job.get("output_path")
        output_root = job.get("output_root") or (_path_parent(output_path) if output_path else None)
        validated["output_path"] = validate_media_path(
            output_path, output_root, VIDEO_OUTPUT_EXTENSIONS
        )

    asset_roots = job.get("asset_roots")
    operations = []
    for raw_operation in job.get("operations", []) or []:
        operation = dict(_normalize_operation(raw_operation))
        for color_field in (
            "font_color",
            "border_color",
            "text_shadow_color",
            "bg_color",
            "delogo_fill_color",
        ):
            if color_field in operation:
                operation[color_field] = _validate_drawtext_color(
                    operation[color_field], color_field
                )
        for field, extensions in (
            ("image_path", IMAGE_EXTENSIONS),
            ("delogo_image_path", IMAGE_EXTENSIONS),
            ("font_path", FONT_EXTENSIONS),
        ):
            media_path = operation.get(field)
            if not media_path:
                continue
            if field == "font_path":
                roots = asset_roots or _path_parent(media_path)
            else:
                if not asset_roots:
                    raise ValueError(
                        f"asset_roots required for {field} when media path is set"
                    )
                roots = asset_roots
            operation[field] = validate_media_path(media_path, roots, extensions)
        operations.append(operation)
    validated["operations"] = operations

    watermark = job.get("watermark")
    if isinstance(watermark, dict):
        watermark = dict(watermark)
        watermark_image = watermark.get("imagePath") or watermark.get("watermark_image")
        if watermark_image:
            if not asset_roots:
                raise ValueError(
                    "asset_roots required for watermark image when media path is set"
                )
            watermark["imagePath"] = validate_media_path(
                watermark_image, asset_roots, IMAGE_EXTENSIONS
            )
        validated["watermark"] = watermark

    return validated
