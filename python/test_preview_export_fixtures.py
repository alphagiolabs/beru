"""Shared preview/export contracts, using the actual JS Job producer at the seam."""

import base64
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

import numpy as np

from job_classify import job_takes_copy_path
from filters import _build_watermark_filter, build_filter_complex
from frame_geometry import normalize_transform, output_layout
from spatial_inpaint import reconstruct_texture
from temporal_motion import _gray, _motion

ROOT = Path(__file__).resolve().parents[1]


def contract(name):
    return json.loads((ROOT / "resources" / f"{name}-fixtures.json").read_text(encoding="utf-8"))


def evaluate(inputs):
    result = {"classify": [not job_takes_copy_path(job) for job in inputs["classify"]]}
    result["geometry"] = []
    for c, transform in zip(contract("output-geometry")["cases"], inputs["geometry"], strict=True):
        width, height, resized, content = output_layout(
            c["frame"]["width"], c["frame"]["height"], normalize_transform(transform)
        )
        result["geometry"].append(
            dict(width=width, height=height, resized=resized, content=content)
        )
    crop = contract("crop-output")
    result["crop"] = []
    for ops in inputs["crop"]:
        graph, _, _ = build_filter_complex(ops, crop["dims"]["w"], crop["dims"]["h"])
        rect = dict(x=0, y=0, width=crop["dims"]["w"], height=crop["dims"]["h"])
        for w, h, x, y in re.findall(r"crop=(\d+):(\d+):(\d+):(\d+):exact=1", graph or ""):
            rect = dict(
                x=rect["x"] + int(x), y=rect["y"] + int(y), width=int(w), height=int(h)
            )
        result["crop"].append(rect)
    watermark = contract("watermark-position")
    result["watermark"] = []
    with tempfile.TemporaryDirectory() as directory:
        image = Path(directory) / "mark.png"
        image.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFe0AAAAASUVORK5CYII="
        ))
        for c in watermark["cases"]:
            positions = {}
            for kind in ("text", "image"):
                wm = {"enabled": True, "type": kind, "text": "WM", "imagePath": str(image)}
                if "position" in c:
                    wm["position"] = c["position"]
                built = _build_watermark_filter(
                    wm, watermark["frame"]["width"], watermark["frame"]["height"]
                )
                if kind == "text":
                    xy = re.search(r":x=([^:]+):y=([^:]+)", built.drawtext_filter).groups()
                    sizes = {
                        "w": watermark["frame"]["width"], "h": watermark["frame"]["height"],
                        "text_w": watermark["mark"]["width"], "text_h": watermark["mark"]["height"],
                    }
                else:
                    xy = built.overlay_position.split(":")
                    sizes = {
                        "W": watermark["frame"]["width"], "H": watermark["frame"]["height"],
                        "w": watermark["mark"]["width"], "h": watermark["mark"]["height"],
                    }
                positions[kind] = dict(zip(
                    ("x", "y"), (eval(expr, {"__builtins__": {}}, sizes) for expr in xy)
                ))
            result["watermark"].append(positions)
    delogo = contract("delogo")
    config = delogo["motion"]
    width, height = config["width"], config["height"]
    seed = 24
    noise = []
    for _ in range((width + 48) * height * 3):
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        noise.append(20 + seed % 210)
    noise = np.array(noise, np.uint8).reshape(height, width + 48, 3)
    yy, xx = np.mgrid[:height, :width]
    result["motion"] = []
    for c in config["cases"]:
        box = c.get("box", config["box"])
        rect = tuple(box[k] for k in ("x", "y", "w", "h"))

        def frame(shift):
            if c["pattern"] == "noise":
                image = noise[:, shift:shift + width].copy()
            else:
                values = (
                    (xx + shift) % c["period"] * 20
                    if c["pattern"] == "periodic" else np.full_like(xx, shift)
                )
                image = np.repeat(values[..., None], 3, axis=2).astype(np.uint8)
            x, y, w, h = rect
            image[y:y + h, x:x + w] = 255
            return image

        motion = _motion(_gray(frame(c["current"])), _gray(frame(c["donor"])), rect)
        result["motion"].append(
            None if motion is None else dict(zip(("dx", "dy", "error"), motion))
        )

    config = delogo["spatial"]
    width, height = config["width"], config["height"]
    x, y, w, h = (config["box"][k] for k in ("x", "y", "w", "h"))
    yy, xx = np.mgrid[:height, :width]
    result["spatial"] = []
    for c in config["cases"]:
        values = 45 + ((xx + c["phase"] + yy // 2) % 12 < 3) * 95 + (yy % 8 < 2) * 35
        clean = np.repeat(values[..., None], 3, axis=2).astype(np.uint8)
        marked = clean.copy()
        marked[y:y + h, x:x + w] = 255
        repaired, _ = reconstruct_texture(marked, (x, y, w, h))
        assert repaired is not None, c["id"]
        outside = np.ones((height, width), bool)
        outside[y - 8:y + h + 8, x - 8:x + w + 8] = False
        assert np.array_equal(repaired[outside], marked[outside]), c["id"]
        error = np.abs(
            repaired[y:y + h, x:x + w].astype(float) - clean[y:y + h, x:x + w]
        ).mean()
        result["spatial"].append(float(error))
    return result


class PreviewExportFixturesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        producer = subprocess.run(
            ["node", "--input-type=module", "-e",
             "import { previewExportInputs } from './tests/helpers/preview-export-inputs.js'; "
             "console.log(JSON.stringify(previewExportInputs()));"],
            cwd=ROOT, capture_output=True, text=True, check=True, timeout=20,
        )
        cls.results = evaluate(json.loads(producer.stdout))

    def test_classify(self):
        for c, actual in zip(contract("job-classify")["cases"], self.results["classify"], strict=True):
            with self.subTest(c["id"]):
                self.assertEqual(actual, c["expected"])

    def test_geometry_and_crop(self):
        for name, key in (("output-geometry", "geometry"), ("crop-output", "crop")):
            for c, actual in zip(contract(name)["cases"], self.results[key], strict=True):
                with self.subTest(name=name, case=c["id"]):
                    self.assertEqual(actual, c["expected"])

    def test_watermark(self):
        for c, actual in zip(contract("watermark-position")["cases"], self.results["watermark"], strict=True):
            with self.subTest(c["id"]):
                self.assertEqual(actual["text"], c["expected"])
                self.assertEqual(actual["image"], c["expected"])

    def test_motion(self):
        for c, actual in zip(contract("delogo")["motion"]["cases"], self.results["motion"], strict=True):
            with self.subTest(c["id"]):
                if c["expected"] is None:
                    self.assertIsNone(actual)
                else:
                    self.assertEqual(
                        (actual["dx"], actual["dy"]),
                        (c["expected"]["dx"], c["expected"]["dy"]),
                    )
                    self.assertAlmostEqual(actual["error"], c["expected"]["error"], places=4)

    def test_spatial(self):
        for c, actual in zip(contract("delogo")["spatial"]["cases"], self.results["spatial"], strict=True):
            with self.subTest(c["id"]):
                self.assertLess(actual, c["maxMeanError"])


if __name__ == "__main__":
    if "--json" in sys.argv:
        print(json.dumps(evaluate(json.load(sys.stdin))))
    else:
        unittest.main()
